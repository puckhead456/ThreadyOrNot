/**
 * KnitChart - reads knitting charts out of a PDF page (wave H, contract section 5).
 *
 * A knitting chart is a grid of symbols with row numbers down the side and a key
 * that says what each symbol means. Charts reach a PDF in three ways and this
 * reader handles each one:
 *
 *   vector   the grid lines and every symbol are path operations (the Interweave
 *            ebooks: thousands of moveTo/lineTo/curveTo, no glyphs). The grid is
 *            rebuilt from the axis-aligned rules, each cell's ink is reduced to a
 *            small shape descriptor and matched against the key's sample boxes,
 *            which are drawn with the same paths. Glyphs from the text layer that
 *            sit inside cells (a "#" or a "2" set in a symbol font) are part of the
 *            descriptor too.
 *   glyph    no vector grid, but the cells are characters of a symbol font laid
 *            out on a regular pitch (StitchMastery / Aire River style fonts). The
 *            grid comes from clustering the glyph positions; the key is a glyph of
 *            the same font beside its meaning.
 *   image    the chart is a raster picture: { cells: null, image: true }. Nothing
 *            is guessed about its rows or symbols.
 *
 * API (window.KnitChart, no DOM; OffscreenCanvas only to judge raster images):
 *   fromHandle(handle, pageNo, opts) -> Promise<Chart[]>   handle = PdfText.open(file)
 *   scan(handle, opts)               -> Promise<[{page, charts}]>  every page; a chart
 *                                       without a key on its own page borrows the key
 *                                       of the nearest page that has one
 *   fromPageData(data, opts)         -> Chart[]   the synchronous core (tests)
 *   readPage(pdfPage)                -> Promise<data>  text items + paths + images
 *   rowCells(chart, rowNo, side)     -> [{sym, text, stitch, c0, c1, consumes, ...}]
 *   rowText(chart, rowNo, side, opts)-> "k2, yo, k2tog, k3" | null
 *   rowInfo(chart, rowNo, side)      -> {text, consumes, produces, unknown} | null
 *   rowNumbers(chart)                -> [rowNo ...] bottom to top
 *   find(charts, name)               -> the chart called "Chart A" / "A" / "Leg" | null
 *   parseMeaning(text)               -> the stitch a key meaning stands for
 *
 * Chart = { name, page, source: 'vector'|'glyph'|'image', image, cols, rows,
 *   cells: [[sym|null]]  cells[0] is the BOTTOM drawn row, cells[r][0] the LEFTMOST
 *                        column; null = no cell drawn there (outside a stepped edge),
 *   spans: [{r, c0, c1, sym}]  symbols drawn across several cells (cables),
 *   legend: [{sym, meaning, stitch, text, rs, ws, color, w, consumes, produces, kind, count}],
 *   noStitch: sym|null, readRS: 'rtl', startRow, rowStep (2 when only every other
 *   row is charted), rowNos: [rowNo per drawn row], labelSide: {rowNo: 'right'|'left'},
 *   repeatBox: {c0, c1, r0, r1, label, only}|null, repeats: [...], marks: [...],
 *   unknown: [{sym, count, at:{r,c}}], bbox, pitch }
 *
 * side for rowText: 'rs' reads right to left, 'ws' left to right, null = in the
 * round (always right to left, side-dependent keys resolve as RS). Left out
 * (undefined), the side comes from where the row's number is printed.
 */
(function () {
  'use strict';

  var VERSION = 1;

  /* pdf.js 3.x operator codes, used when pdfjsLib is not loaded (synthetic tests). */
  var OPS_FALLBACK = {
    setLineWidth: 2, setGState: 9, save: 10, restore: 11, transform: 12, moveTo: 13,
    lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19,
    stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25,
    closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, clip: 29, eoClip: 30, setStrokeColorN: 53,
    setFillColorN: 55, setStrokeGray: 56, setFillGray: 57, setStrokeRGBColor: 58,
    setFillRGBColor: 59, setStrokeCMYKColor: 60, setFillCMYKColor: 61,
    paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85,
    paintInlineImageXObject: 86, paintImageXObjectRepeat: 88, constructPath: 91,
    showText: 44, showSpacedText: 45
  };

  function opsTable() {
    var lib = typeof window !== 'undefined' ? window.pdfjsLib : null;
    return (lib && lib.OPS) || OPS_FALLBACK;
  }

  /* ================================================================== *
   * 1. Small helpers
   * ================================================================== */

  var WHITE = [255, 255, 255];

  function abs(v) { return v < 0 ? -v : v; }
  function hyp(a, b) { return Math.sqrt(a * a + b * b); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }
  function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function bboxOf(pts) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p[0] < b.x0) b.x0 = p[0];
      if (p[0] > b.x1) b.x1 = p[0];
      if (p[1] < b.y0) b.y0 = p[1];
      if (p[1] > b.y1) b.y1 = p[1];
    }
    return b;
  }
  function bw(b) { return b.x1 - b.x0; }
  function bh(b) { return b.y1 - b.y0; }
  function bcx(b) { return (b.x0 + b.x1) / 2; }
  function bcy(b) { return (b.y0 + b.y1) / 2; }
  function unionBox(a, b) {
    if (!a) return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  }
  function boxesTouch(a, b, pad) {
    return a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
  }
  function lum(c) { c = c || WHITE; return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  function isNeutral(c) {
    if (!c) return true;
    return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) <= 40;
  }
  function isWhite(c) { return !c || (c[0] >= 242 && c[1] >= 242 && c[2] >= 242); }
  function colorDist(a, b) {
    a = a || WHITE; b = b || WHITE;
    var r = a[0] - b[0], g = a[1] - b[1], u = a[2] - b[2];
    return Math.sqrt(r * r + g * g + u * u);
  }
  function hex(c) {
    if (!c) return null;
    var s = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.max(0, Math.min(255, Math.round(c[i])));
      s += (v < 16 ? '0' : '') + v.toString(16);
    }
    return s;
  }
  function rgbFrom(a) {
    if (!a) return [0, 0, 0];
    if (typeof a === 'string') return rgbFrom([a]);
    if (typeof a[0] === 'string' && a[0].charAt(0) === '#' && a[0].length >= 7) {
      var h = a[0];
      return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
    }
    var r = +a[0], g = +a[1], b = +a[2];
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return [0, 0, 0];
    if (r <= 1 && g <= 1 && b <= 1 && (r % 1 || g % 1 || b % 1)) return [r * 255, g * 255, b * 255];
    return [r, g, b];
  }
  function grayFrom(a) {
    var g = +((a && a[0]) || 0);
    if (g <= 1) g *= 255;
    return [g, g, g];
  }
  function cmykFrom(a) {
    var c = +a[0] || 0, m = +a[1] || 0, y = +a[2] || 0, k = +a[3] || 0;
    return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
  }
  function copy(o) {
    var r = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
    return r;
  }

  /* ================================================================== *
   * 2. Reading a page: text items and painted paths
   * ================================================================== */

  /**
   * Text items with their quarter turn q (0 upright, 1 = 90deg anticlockwise,
   * 2, 3); slanted text is dropped. A chart set sideways on its page has its
   * row numbers and caption turned with it.
   */
  function textItems(items, styles) {
    var out = [];
    (items || []).forEach(function (it) {
      if (!it || typeof it.str !== 'string') return;
      var s = it.str;
      if (!s.replace(/\s+/g, '')) return;
      var t = it.transform || [1, 0, 0, 1, 0, 0];
      var size = hyp(t[0], t[1]) || hyp(t[2], t[3]) || 10;
      var q;
      if (abs(t[1]) <= 0.05 * size && abs(t[2]) <= 0.05 * size) q = t[0] > 0 ? 0 : 2;
      else if (abs(t[0]) <= 0.05 * size && abs(t[3]) <= 0.05 * size) q = t[1] > 0 ? 1 : 3;
      else return;
      // pdf.js measures width along the baseline and height as the font size
      var h = it.height || size;
      var w = it.width || s.length * h * 0.5;
      var x = t[4], y = t[5];
      // Leading / trailing spaces widen the item without ink; trim them off.
      var lead = s.length - s.replace(/^\s+/, '').length;
      var trail = s.length - s.replace(/\s+$/, '').length;
      if (lead || trail) {
        var per = w / s.length;
        if (q === 0) x += lead * per;
        else if (q === 2) x -= lead * per;
        else if (q === 1) y += lead * per;
        else y -= lead * per;
        w -= (lead + trail) * per;
        s = s.replace(/^\s+|\s+$/g, '');
      }
      var st = (styles && styles[it.fontName]) || {};
      out.push({ str: s, x: x, y: y, w: w, h: h, q: q, font: it.fontName || '', family: st.fontFamily || '' });
    });
    return out;
  }

  /** (x, y) turned by -q quarter turns, so text of turn q reads upright. */
  function turnPt(p, q) {
    if (q === 1) return [p[1], -p[0]];
    if (q === 2) return [-p[0], -p[1]];
    if (q === 3) return [-p[1], p[0]];
    return [p[0], p[1]];
  }

  /** The page seen with its q-turned text upright. */
  function turnData(data, q) {
    function pts(list) { return list.map(function (p) { return turnPt(p, q); }); }
    var shapes = (data.shapes || []).map(function (s) {
      var o = copy(s);
      o.clip = null;
      o.subs = s.subs.map(function (sb) { var n = copy(sb); n.pts = pts(sb.pts); return n; });
      return o;
    });
    var images = (data.images || []).map(function (im) {
      var o = copy(im);
      o.bb = bboxOf(pts([[im.bb.x0, im.bb.y0], [im.bb.x1, im.bb.y1]]));
      return o;
    });
    var texts = (data.texts || []).filter(function (t) { return t.q === q; }).map(function (t) {
      var o = copy(t);
      var p = turnPt([t.x, t.y], q);
      o.x = p[0]; o.y = p[1]; o.q = 0;
      return o;
    });
    return { width: data.width, height: data.height, texts: texts, shapes: shapes, images: images };
  }

  /** Walks a pdf.js operator list into painted shapes and placed images. */
  function walkOps(ol, O) {
    O = O || opsTable();
    var fns = (ol && ol.fnArray) || [], args = (ol && ol.argsArray) || [];
    var ctm = [1, 0, 0, 1, 0, 0], fill = [0, 0, 0], stroke = [0, 0, 0], lw = 1, clip = null;
    var stack = [], shapes = [], images = [], subs = null, clipNext = false, textOps = [];
    var paint = {};
    paint[O.stroke] = 'S'; paint[O.closeStroke] = 'S';
    paint[O.fill] = 'F'; paint[O.eoFill] = 'F';
    paint[O.fillStroke] = 'B'; paint[O.eoFillStroke] = 'B';
    paint[O.closeFillStroke] = 'B'; paint[O.closeEOFillStroke] = 'B';
    var closes = {};
    closes[O.closeStroke] = closes[O.closeFillStroke] = closes[O.closeEOFillStroke] = true;
    var imageOps = {};
    imageOps[O.paintImageXObject] = 1;
    imageOps[O.paintInlineImageXObject] = 1;
    if (O.paintImageXObjectRepeat != null) imageOps[O.paintImageXObjectRepeat] = 1;

    for (var i = 0; i < fns.length; i++) {
      var fn = fns[i], a = args[i] || [];
      if (fn === O.save) stack.push([ctm, fill, stroke, lw, clip]);
      else if (fn === O.restore) {
        var s = stack.pop();
        if (s) { ctm = s[0]; fill = s[1]; stroke = s[2]; lw = s[3]; clip = s[4]; }
      } else if (fn === O.transform) ctm = mul(ctm, a);
      else if (fn === O.paintFormXObjectBegin) {
        stack.push([ctm, fill, stroke, lw, clip]);
        if (a[0] && a[0].length === 6) ctm = mul(ctm, a[0]);
      } else if (fn === O.paintFormXObjectEnd) {
        var f = stack.pop();
        if (f) { ctm = f[0]; fill = f[1]; stroke = f[2]; lw = f[3]; clip = f[4]; }
      } else if (fn === O.clip || fn === O.eoClip) clipNext = true;
      else if (fn === O.setLineWidth) lw = +a[0] || 0;
      else if (fn === O.setGState) {
        (a[0] || []).forEach(function (kv) { if (kv && kv[0] === 'LW') lw = +kv[1] || 0; });
      } else if (fn === O.setFillRGBColor) fill = rgbFrom(a);
      else if (fn === O.setStrokeRGBColor) stroke = rgbFrom(a);
      else if (fn === O.setFillGray) fill = grayFrom(a);
      else if (fn === O.setStrokeGray) stroke = grayFrom(a);
      else if (fn === O.setFillCMYKColor) fill = cmykFrom(a);
      else if (fn === O.setStrokeCMYKColor) stroke = cmykFrom(a);
      else if (fn === O.setFillColorN) fill = typeof a[0] === 'string' && a[0].charAt(0) !== '#' ? [190, 190, 190] : rgbFrom(a);
      else if (fn === O.setStrokeColorN) stroke = typeof a[0] === 'string' && a[0].charAt(0) !== '#' ? [190, 190, 190] : rgbFrom(a);
      else if (fn === O.constructPath) subs = (subs || []).concat(buildSubs(a, ctm, O));
      else if (paint[fn]) {
        var newClip = clipNext && subs && subs.length ? clipOf(subs, clip) : clip;
        if (subs && subs.length) {
          var kind = paint[fn];
          var scale = Math.sqrt(abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
          if (closes[fn]) subs.forEach(function (sb) { sb.closed = true; });
          var kept = clip ? clipSubs(subs, clip, kind === 'S') : subs;
          if (kept.length) {
            shapes.push({
              fill: kind !== 'S' ? fill : null,
              stroke: kind !== 'F' ? stroke : null,
              lw: lw * scale,
              clip: clip,
              subs: kept
            });
          }
        }
        clip = newClip;
        clipNext = false;
        subs = null;
      } else if (fn === O.endPath) {
        if (clipNext && subs && subs.length) clip = clipOf(subs, clip);
        clipNext = false;
        subs = null;
      }
      else if (fn === O.showText || fn === O.showSpacedText) {
        // remembered with the clip in force, to drop text a clip hides
        var str = '';
        (fn === O.showText ? a[0] : a[0]).forEach(function (gl) { if (gl && typeof gl === 'object' && gl.unicode) str += gl.unicode; });
        textOps.push({ str: str.replace(/\s+/g, ''), clip: clip });
      } else if (imageOps[fn]) {
        var corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
        images.push({ id: typeof a[0] === 'string' ? a[0] : null, w: +a[1] || 0, h: +a[2] || 0, bb: bboxOf(corners) });
      }
    }
    return { shapes: shapes, images: images, textOps: textOps };
  }

  /**
   * The clip region: its box plus the clip paths themselves, one layer per
   * clip operation (a point must be inside every layer). Colourwork charts clip
   * each colour's symbols to that colour's cells, so the shape matters.
   */
  function clipOf(subs, prev) {
    var pts = [];
    subs.forEach(function (s) { pts = pts.concat(s.pts); });
    var b = bboxOf(pts);
    if (prev) b = { x0: Math.max(b.x0, prev.x0), y0: Math.max(b.y0, prev.y0), x1: Math.min(b.x1, prev.x1), y1: Math.min(b.y1, prev.y1) };
    var layer = subs.filter(function (s) { return s.pts.length >= 3; }).map(function (s) { return s.pts; });
    b.layers = (prev && prev.layers ? prev.layers : []).concat(layer.length ? [layer] : []);
    return b;
  }

  function clipVisible(clip, x, y) {
    if (!clip) return true;
    if (x < clip.x0 - 0.5 || x > clip.x1 + 0.5 || y < clip.y0 - 0.5 || y > clip.y1 + 0.5) return false;
    var layers = clip.layers || [];
    for (var i = 0; i < layers.length; i++) {
      var any = false;
      for (var j = 0; j < layers[i].length && !any; j++) {
        var poly = layers[i][j], pb = bboxOf(poly);
        // a rectangle is tested by its box (with a hair of slack on the edges)
        var isBox = poly.length === 4 && edgeKinds(poly, true).every(function (k) { return k === 'h' || k === 'v'; });
        if (isBox && x >= pb.x0 - 0.3 && x <= pb.x1 + 0.3 && y >= pb.y0 - 0.3 && y <= pb.y1 + 0.3) any = true;
        else if (inPoly(x, y, poly)) any = true;
      }
      if (!any) return false;
    }
    return true;
  }

  /** Liang-Barsky: the part of segment a-b inside box, or null. */
  function clipSeg(a, b, box) {
    var t0 = 0, t1 = 1, dx = b[0] - a[0], dy = b[1] - a[1];
    var p = [-dx, dx, -dy, dy], q = [a[0] - box.x0, box.x1 - a[0], a[1] - box.y0, box.y1 - a[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < -0.01) return null; continue; }
      var r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  }

  /** Drop what the clip hides; stroked straight lines are cut to the clip box. */
  function clipSubs(subs, box, strokeOnly) {
    var pad = 0.3;
    var B = { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
    var out = [];
    subs.forEach(function (s) {
      var bb = bboxOf(s.pts);
      if (bb.x1 < B.x0 || bb.x0 > B.x1 || bb.y1 < B.y0 || bb.y0 > B.y1) return;
      if (s.curved || !strokeOnly || s.pts.length < 2) {
        // a symbol or a fill: kept when its middle is inside the clip
        if (clipVisible(box, bcx(bb), bcy(bb))) out.push(s);
        return;
      }
      var n = s.pts.length, m = s.closed && n > 2 ? n : n - 1, run = null;
      for (var k = 0; k < m; k++) {
        var seg = clipSeg(s.pts[k], s.pts[(k + 1) % n], B);
        if (seg && !clipVisible(box, (seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2)) seg = null;
        if (!seg) { run = null; continue; }
        if (run && near(run.pts[run.pts.length - 1], seg[0], 0.01)) run.pts.push(seg[1]);
        else { run = { pts: [seg[0], seg[1]], curved: false, closed: false, rect: false }; out.push(run); }
      }
    });
    return out;
  }

  function buildSubs(a, ctm, O) {
    var ops = a[0] || [], c = a[1] || [], k = 0, subs = [], cur = null, start = null;
    function last() { return cur.pts[cur.pts.length - 1]; }
    function begin(p) { cur = { pts: [p], curved: false, closed: false, rect: false }; subs.push(cur); start = p; }
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op === O.moveTo) { begin(apply(ctm, c[k], c[k + 1])); k += 2; }
      else if (op === O.lineTo) {
        var p = apply(ctm, c[k], c[k + 1]); k += 2;
        if (!cur) begin(start || p);
        cur.pts.push(p);
      } else if (op === O.curveTo || op === O.curveTo2 || op === O.curveTo3) {
        var p0, c1, c2, p3;
        if (!cur) begin(start || apply(ctm, 0, 0));
        p0 = last();
        if (op === O.curveTo) {
          c1 = apply(ctm, c[k], c[k + 1]); c2 = apply(ctm, c[k + 2], c[k + 3]); p3 = apply(ctm, c[k + 4], c[k + 5]); k += 6;
        } else if (op === O.curveTo2) {
          c1 = p0; c2 = apply(ctm, c[k], c[k + 1]); p3 = apply(ctm, c[k + 2], c[k + 3]); k += 4;
        } else {
          c1 = apply(ctm, c[k], c[k + 1]); p3 = apply(ctm, c[k + 2], c[k + 3]); c2 = p3; k += 4;
        }
        // The curve's midpoint keeps the bbox honest for two-arc circles.
        cur.pts.push([(p0[0] + 3 * c1[0] + 3 * c2[0] + p3[0]) / 8, (p0[1] + 3 * c1[1] + 3 * c2[1] + p3[1]) / 8]);
        cur.pts.push(p3);
        cur.curved = true;
      } else if (op === O.rectangle) {
        var x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3]; k += 4;
        subs.push({ pts: [apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h)], curved: false, closed: true, rect: true });
        cur = null;
        start = apply(ctm, x, y);
      } else if (op === O.closePath) {
        if (cur) { cur.closed = true; start = cur.pts[0]; }
        cur = null;
      }
    }
    return subs;
  }

  function near(a, b, t) { return abs(a[0] - b[0]) <= t && abs(a[1] - b[1]) <= t; }

  /** Edge directions of a straight outline: 'h', 'v', 'd' (diagonal) or '0'. */
  /** 'h', 'v', 'd' (diagonal) or '0' (a dot); a scan's slight skew still counts as straight. */
  function axisOf(a, b) {
    var dx = abs(b[0] - a[0]), dy = abs(b[1] - a[1]);
    if (dx <= 0.3 && dy <= 0.3) return '0';
    if (dy <= 0.3 + 0.012 * dx) return 'h';
    if (dx <= 0.3 + 0.012 * dy) return 'v';
    return 'd';
  }

  function edgeKinds(pts, closed) {
    var out = [], n = pts.length, m = closed ? n : n - 1;
    for (var i = 0; i < m; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      var dx = abs(b[0] - a[0]), dy = abs(b[1] - a[1]);
      out.push(axisOf(a, b));
    }
    return out;
  }

  /** Every painted sub-path as a primitive with its bbox and drawing order. */
  function primitives(shapes) {
    var prims = [];
    shapes.forEach(function (s, si) {
      s.subs.forEach(function (sub) {
        var pts = sub.pts;
        if (!pts.length) return;
        var closed = !!sub.closed || !!s.fill;
        if (!sub.curved && pts.length > 2 && near(pts[0], pts[pts.length - 1], 0.05)) {
          pts = pts.slice(0, -1);
          closed = true;
        }
        var bb = bboxOf(pts);
        var rect = !!sub.rect;
        if (!rect && !sub.curved && pts.length === 4 && closed) {
          var ek = edgeKinds(pts, true);
          rect = (ek[0] === 'h' && ek[1] === 'v' && ek[2] === 'h' && ek[3] === 'v') ||
                 (ek[0] === 'v' && ek[1] === 'h' && ek[2] === 'v' && ek[3] === 'h');
        }
        // A box drawn as an open three- or four-sided outline (socks key boxes).
        var boxLike = rect;
        if (!boxLike && !sub.curved && (pts.length === 4 || pts.length === 5) && bw(bb) > 2 && bh(bb) > 2) {
          var kinds = edgeKinds(pts, false).filter(function (k) { return k !== '0'; });
          boxLike = kinds.length >= 3 && kinds.every(function (k, i) { return k !== 'd' && (i === 0 || k !== kinds[i - 1]); });
        }
        prims.push({
          z: prims.length, shape: si, pts: pts, curved: !!sub.curved, closed: closed,
          rect: rect, boxLike: boxLike, filled: !!s.fill, stroked: !!s.stroke,
          fill: s.fill, stroke: s.stroke, lw: s.lw, bb: bb
        });
      });
    });
    return occlude(prims);
  }

  /**
   * A white rectangle painted later hides what is under it (a label backdrop
   * over the end of a bracket). Straight strokes are cut around it; anything
   * wholly inside it is dropped.
   */
  function occlude(prims) {
    var CELL = 40, buckets = {};
    function keys(b) {
      var out = [];
      for (var x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++)
        for (var y = Math.floor(b.y0 / CELL); y <= Math.floor(b.y1 / CELL); y++) out.push(x + ':' + y);
      return out;
    }
    var whites = prims.filter(function (p) { return p.filled && p.rect && isWhite(p.fill) && bw(p.bb) > 1.5 && bh(p.bb) > 1.5; });
    if (!whites.length) return prims;
    prims.forEach(function (p, i) { keys(p.bb).forEach(function (k) { (buckets[k] = buckets[k] || []).push(i); }); });
    var dead = {}, replaced = {};
    whites.forEach(function (w) {
      var hole = { x0: w.bb.x0 + 0.25, y0: w.bb.y0 + 0.25, x1: w.bb.x1 - 0.25, y1: w.bb.y1 - 0.25 };
      if (hole.x1 <= hole.x0 || hole.y1 <= hole.y0) return;
      var seen = {};
      keys(w.bb).forEach(function (k) {
        (buckets[k] || []).forEach(function (i) {
          if (seen[i]) return;
          seen[i] = true;
          var p = replaced[i] || prims[i];
          if (p.z >= w.z || dead[i]) return;
          var b = p.bb;
          if (b.x1 < hole.x0 || b.x0 > hole.x1 || b.y1 < hole.y0 || b.y0 > hole.y1) return;
          if (b.x0 >= hole.x0 && b.x1 <= hole.x1 && b.y0 >= hole.y0 && b.y1 <= hole.y1) { dead[i] = true; return; }
          if (p.curved || !p.stroked || p.filled) return;
          // cut each segment around the hole
          var n = p.pts.length, m = p.closed && n > 2 ? n : n - 1, pieces = [];
          for (var s = 0; s < m; s++) {
            var a = p.pts[s], c = p.pts[(s + 1) % n];
            var inside = clipSeg(a, c, hole);
            if (!inside) { pieces.push([a, c]); continue; }
            var len = hyp(c[0] - a[0], c[1] - a[1]) || 1;
            var t0 = hyp(inside[0][0] - a[0], inside[0][1] - a[1]) / len, t1 = hyp(inside[1][0] - a[0], inside[1][1] - a[1]) / len;
            if (t0 > 0.001) pieces.push([a, inside[0]]);
            if (t1 < 0.999) pieces.push([inside[1], c]);
          }
          if (!pieces.length) { dead[i] = true; return; }
          var np = copy(p);
          np.pts = pieces[0].slice();
          np.closed = false;
          np.rect = false;
          np.boxLike = false;
          np.extra = (p.extra || []).concat(pieces.slice(1));
          np.bb = bboxOf(np.pts);
          replaced[i] = np;
        });
      });
    });
    var out = [];
    prims.forEach(function (p, i) {
      if (dead[i]) return;
      var r = replaced[i];
      if (!r) { out.push(p); return; }
      var extra = r.extra;
      delete r.extra;
      out.push(r);
      extra.forEach(function (seg) {
        var e = copy(r);
        e.pts = seg.slice();
        e.bb = bboxOf(e.pts);
        out.push(e);
      });
    });
    return out;
  }

  /**
   * Text items whose show-text operation ran under a clip that hides them (a
   * page laid over another one, its text still in the text layer) are dropped.
   * Items and operations come in the same order; they are paired by content.
   */
  function dropClipped(items, ops) {
    if (!ops || !ops.length) return items;
    var j = 0;
    return items.filter(function (it) {
      var s = String(it.str || '').replace(/\s+/g, '');
      if (!s) return true;
      var t = it.transform || [1, 0, 0, 1, 0, 0];
      for (var k = j; k < ops.length && k < j + 60; k++) {
        var o = ops[k].str;
        if (!o || (o.indexOf(s) < 0 && s.indexOf(o) < 0)) continue;
        j = k + (o.length <= s.length ? 1 : 0);
        var c = ops[k].clip;
        if (!c) return true;
        var h = it.height || hyp(t[2], t[3]) || 10;
        var cx = t[4] + (it.width || 0) / 2, cy = t[5] + h * 0.35;
        return clipVisible(c, cx, cy);
      }
      return true;
    });
  }

  /** pdf.js page -> plain data the analysis needs (no pdf.js objects inside). */
  function readPage(page, opts) {
    opts = opts || {};
    var O = opsTable();
    var size = { width: 612, height: 792 };
    try {
      var vp = page.getViewport({ scale: 1 });
      if (vp && vp.width) { size.width = vp.width; size.height = vp.height; }
    } catch (e) { /* default letter */ }
    return page.getTextContent().then(function (tc) {
      return page.getOperatorList().then(function (ol) {
        var g = walkOps(ol, O);
        var texts = textItems(dropClipped(tc.items || [], g.textOps), tc.styles);
        var data = { width: size.width, height: size.height, texts: texts, shapes: g.shapes, images: g.images };
        if (opts.judgeImages === false || !g.images.length) return data;
        return judgeImages(page, data).then(function () { return data; });
      });
    });
  }

  /* ================================================================== *
   * 3. Raster images: does this picture look like a chart?
   * ================================================================== */

  function imagePixels(obj) {
    if (!obj) return null;
    var w = obj.width, h = obj.height;
    if (obj.data && obj.data.length && w && h) {
      var per = obj.data.length / (w * h);
      if (per === 3 || per === 4) return { w: w, h: h, data: obj.data, per: per };
      return null;
    }
    var bmp = obj.bitmap || (typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap ? obj : null);
    if (bmp && typeof OffscreenCanvas !== 'undefined') {
      try {
        var cw = bmp.width, ch = bmp.height;
        var scale = Math.min(1, 900 / Math.max(cw, ch));
        var tw = Math.max(1, Math.round(cw * scale)), th = Math.max(1, Math.round(ch * scale));
        var oc = new OffscreenCanvas(tw, th);
        var ctx = oc.getContext('2d');
        ctx.drawImage(bmp, 0, 0, tw, th);
        return { w: tw, h: th, data: ctx.getImageData(0, 0, tw, th).data, per: 4 };
      } catch (e) { return null; }
    }
    return null;
  }

  /**
   * A chart picture is mostly white with long thin dark rules in both directions;
   * a photo or a knitted swatch is neither. Returns true / false / null (unknown).
   */
  function pixelsLookLikeChart(px) {
    if (!px || px.w < 40 || px.h < 40) return null;
    var w = px.w, h = px.h, d = px.data, per = px.per;
    var white = 0, total = w * h;
    var dark = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) * per;
        var l = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
        if (l > 225) white++;
        if (l < 170) dark[y * w + x] = 1;
      }
    }
    if (white / total < 0.3) return false;
    // rules: rows (columns) where a long dark run crosses a good part of the picture
    function lines(len, other, at) {
      var pos = [], prev = false;
      for (var i = 0; i < len; i++) {
        var run = 0, best = 0;
        for (var j = 0; j < other; j++) {
          if (at(i, j)) { run++; if (run > best) best = run; } else run = 0;
        }
        var on = best >= other * 0.3;
        if (on && !prev) pos.push(i);
        prev = on;
      }
      return pos;
    }
    // a grid is evenly spaced: the longest run of equal gaps
    function evenRun(pos) {
      var best = 0;
      for (var i = 1; i < pos.length; i++) {
        var g = pos[i] - pos[i - 1], n = 1;
        for (var k = i + 1; k < pos.length && abs((pos[k] - pos[k - 1]) - g) <= Math.max(1.5, 0.2 * g); k++) n++;
        if (g >= 3 && n > best) best = n;
      }
      return best;
    }
    var hl = lines(h, w, function (i, j) { return dark[i * w + j]; });
    var vl = lines(w, h, function (i, j) { return dark[j * w + i]; });
    return evenRun(hl) >= 4 && evenRun(vl) >= 4;
  }

  function judgeImages(page, data) {
    var jobs = data.images.map(function (im) {
      // images used more than once live in commonObjs ("g_..." ids)
      var objs = im.id && /^g_/.test(im.id) ? page.commonObjs : page.objs;
      if (!im.id || !objs || bw(im.bb) < 90 || bh(im.bb) < 60) return Promise.resolve();
      return new Promise(function (resolve) {
        var done = false;
        function finish(obj) {
          if (done) return;
          done = true;
          try { im.chartLike = pixelsLookLikeChart(imagePixels(obj)); } catch (e) { im.chartLike = null; }
          resolve();
        }
        try {
          if (typeof objs.has === 'function' && objs.has(im.id)) finish(objs.get(im.id));
          else objs.get(im.id, finish);
        } catch (e) { finish(null); }
        setTimeout(function () { finish(null); }, 1500);
      });
    });
    return Promise.all(jobs);
  }

  /* ================================================================== *
   * 4. Text lines (titles, key meanings, row numbers)
   * ================================================================== */

  /** A key's sample glyph ("#", "2") is not a word of the meaning beside it. */
  function glyphish(items) { return items.length === 1 && items[0].str.length <= 2 && !/[a-z]/i.test(items[0].str); }

  function joinable(lnItems, it, gap, h) {
    if (gap > h * 1.1) return false;
    // Different words printed over each other are two text layers, not one line
    // (a hidden overlay of another page's text); the same word twice is an overprint.
    for (var i = 0; i < lnItems.length; i++) {
      var o = lnItems[i];
      var ov = Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x);
      if (ov > 0.3 * Math.min(o.w, it.w) && o.str.indexOf(it.str) < 0 && it.str.indexOf(o.str) < 0) return false;
    }
    if (gap > h * 0.45 && (glyphish(lnItems) || glyphish([it]))) return false;
    return true;
  }

  function buildLines(texts) {
    var items = texts.slice().sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });
    var lines = [];
    items.forEach(function (it) {
      var best = null;
      for (var i = lines.length - 1; i >= 0 && i >= lines.length - 40; i--) {
        var ln = lines[i];
        var lo = Math.max(ln.y, it.y), hi = Math.min(ln.y + ln.h, it.y + it.h);
        if (hi - lo < 0.45 * Math.min(ln.h, it.h)) continue;
        // Same line only when the gap is word-sized.
        var gap = it.x >= ln.x1 ? it.x - ln.x1 : ln.x0 - (it.x + it.w);
        if (it.x < ln.x1 && it.x + it.w > ln.x0) gap = 0;
        if (!joinable(ln.items, it, gap, Math.max(ln.h, it.h))) continue;
        best = ln;
        break;
      }
      if (!best) {
        best = { items: [], x0: it.x, x1: it.x + it.w, y: it.y, h: it.h, text: '' };
        lines.push(best);
      }
      best.items.push(it);
      best.x0 = Math.min(best.x0, it.x);
      best.x1 = Math.max(best.x1, it.x + it.w);
      if (it.h > best.h) { best.y = it.y; best.h = it.h; }
    });
    // Superscript / subscript pieces ("42 1/2") can start a line of their own;
    // lines that overlap in height and touch end to end are one line.
    var merged = true;
    while (merged) {
      merged = false;
      for (var a = 0; a < lines.length && !merged; a++) {
        for (var b = a + 1; b < lines.length && !merged; b++) {
          var A = lines[a], B = lines[b];
          var ov = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
          if (ov < 0.45 * Math.min(A.h, B.h)) continue;
          var gap = Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1);
          if (gap > 1.1 * Math.max(A.h, B.h)) continue;
          if (gap > 0.45 * Math.max(A.h, B.h) && (glyphish(A.items) || glyphish(B.items))) continue;
          if (B.items.some(function (it) { return !joinable(A.items, it, Math.max(0, gap), Math.max(A.h, B.h)); })) continue;
          A.items = A.items.concat(B.items);
          A.x0 = Math.min(A.x0, B.x0);
          A.x1 = Math.max(A.x1, B.x1);
          if (B.h > A.h) { A.y = B.y; A.h = B.h; }
          lines.splice(b, 1);
          merged = true;
        }
      }
    }
    lines.forEach(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var s = '', prevEnd = null;
      ln.items.forEach(function (it) {
        // overprinted letters (a title set twice in place) add nothing
        if (prevEnd != null && it.x + it.w <= prevEnd + 0.5 && it.x < prevEnd - 0.5 * it.w) return;
        if (prevEnd != null && it.x - prevEnd > 0.18 * it.h && !/\s$/.test(s)) s += ' ';
        s += it.str;
        prevEnd = it.x + it.w;
      });
      // "42 1 ⁄ 2" -> "42 1/2"
      s = s.replace(/\s*⁄\s*/g, '/').replace(/(\d) ?(\d)\/(\d)/g, '$1 $2/$3').replace(/\s+/g, ' ').trim();
      ln.text = s;
      ln.cy = ln.y + ln.h * 0.35;
    });
    // Duplicate overlays (the same words printed twice in place) collapse to one.
    var seen = {};
    return lines.filter(function (ln) {
      var key = Math.round(ln.x0) + ':' + Math.round(ln.y) + ':' + ln.text;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /* ================================================================== *
   * 5. Grid rules -> lattices
   * ================================================================== */

  function rulesOf(prims) {
    var rules = [];
    function seg(a, b, color, lw, p) {
      var dx = b[0] - a[0], dy = b[1] - a[1];
      if (axisOf(a, b) === 'h' && abs(dx) >= 0.8) rules.push({ o: 'h', p: (a[1] + b[1]) / 2, a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]), color: color, lw: lw, prim: p });
      else if (axisOf(a, b) === 'v' && abs(dy) >= 0.8) rules.push({ o: 'v', p: (a[0] + b[0]) / 2, a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]), color: color, lw: lw, prim: p });
    }
    prims.forEach(function (p) {
      if (p.curved) return;
      if (p.stroked) {
        var n = p.pts.length, m = p.closed && n > 2 ? n : n - 1;
        for (var k = 0; k < m; k++) seg(p.pts[k], p.pts[(k + 1) % n], p.stroke, p.lw, p);
      }
      if (p.filled && p.rect) {
        var w = bw(p.bb), h = bh(p.bb), t = Math.min(w, h), L = Math.max(w, h);
        if (t <= 1.3 && L >= Math.max(2, 3 * t)) {
          if (w >= h) rules.push({ o: 'h', p: bcy(p.bb), a: p.bb.x0, b: p.bb.x1, color: p.fill, lw: t, prim: p, thin: true });
          else rules.push({ o: 'v', p: bcx(p.bb), a: p.bb.y0, b: p.bb.y1, color: p.fill, lw: t, prim: p, thin: true });
        }
      }
    });
    return rules;
  }

  function isGridRule(r) { return isNeutral(r.color) && lum(r.color) < 236 && r.lw <= 3.2; }

  function mergeRules(rules) {
    var list = rules.slice().sort(function (a, b) { return (a.p - b.p) || (a.a - b.a); });
    var out = [], i = 0;
    while (i < list.length) {
      var j = i, p0 = list[i].p;
      while (j < list.length && list[j].p - p0 <= 0.45) j++;
      var group = list.slice(i, j).sort(function (a, b) { return a.a - b.a; });
      var sumP = 0;
      group.forEach(function (r) { sumP += r.p; });
      var pAvg = sumP / group.length;
      var cur = null;
      group.forEach(function (r) {
        if (cur && r.a <= cur.b + 0.75) {
          if (r.b > cur.b) cur.b = r.b;
          cur.lw = Math.max(cur.lw, r.lw);
        } else {
          cur = { o: r.o, p: pAvg, a: r.a, b: r.b, lw: r.lw, color: r.color };
          out.push(cur);
        }
      });
      i = j;
    }
    return out;
  }

  function components(H, V) {
    var n = H.length + V.length, parent = [];
    for (var i = 0; i < n; i++) parent.push(i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    var Vs = V.map(function (v, k) { return { v: v, k: k }; }).sort(function (a, b) { return a.v.p - b.v.p; });
    var tol = 0.8;
    H.forEach(function (h, hi) {
      var lo = 0, top = Vs.length;
      while (lo < top) { var mid = (lo + top) >> 1; if (Vs[mid].v.p < h.a - tol) lo = mid + 1; else top = mid; }
      for (var q = lo; q < Vs.length && Vs[q].v.p <= h.b + tol; q++) {
        var v = Vs[q].v;
        if (h.p >= v.a - tol && h.p <= v.b + tol) union(hi, H.length + Vs[q].k);
      }
    });
    var groups = {};
    for (var k = 0; k < n; k++) {
      var r = find(k);
      if (!groups[r]) groups[r] = { H: [], V: [] };
      if (k < H.length) groups[r].H.push(H[k]); else groups[r].V.push(V[k - H.length]);
    }
    return Object.keys(groups).map(function (key) { return groups[key]; });
  }

  /** Distinct positions of a set of {p} (merged within 0.5pt). */
  function positions(rules) {
    var ps = rules.map(function (r) { return r.p; }).sort(function (a, b) { return a - b; });
    var out = [];
    ps.forEach(function (p) {
      var o = out[out.length - 1];
      if (o && p - o.last <= 0.5) { o.sum += p; o.n++; o.last = p; }
      else out.push({ sum: p, n: 1, last: p });
    });
    return out.map(function (o) { return o.sum / o.n; });
  }

  function modePitch(diffs) {
    var best = 0, bestN = 0;
    diffs.forEach(function (d) {
      var n = 0;
      diffs.forEach(function (e) { if (abs(e - d) <= 0.07 * d) n++; });
      if (n > bestN || (n === bestN && d < best)) { best = d; bestN = n; }
    });
    var sum = 0, cnt = 0;
    diffs.forEach(function (e) { if (abs(e - best) <= 0.07 * best) { sum += e; cnt++; } });
    return { pitch: cnt ? sum / cnt : best, n: bestN };
  }

  /** Evenly spaced boundaries (missing ones interpolated), the longest regular run. */
  function regularize(pos) {
    if (pos.length < 2) return null;
    var diffs = [];
    for (var i = 1; i < pos.length; i++) if (pos[i] - pos[i - 1] > 1) diffs.push(pos[i] - pos[i - 1]);
    if (!diffs.length) return null;
    var pitch = modePitch(diffs).pitch;
    if (!(pitch > 0)) return null;
    var runs = [], run = [pos[0]], real = 1, reals = [];
    for (var j = 1; j < pos.length; j++) {
      var q = pos[j], last = run[run.length - 1], d = q - last;
      // A rule inside a cell (a purl dash, a bracket) is not a boundary.
      if (d < 0.75 * pitch) continue;
      var k = Math.round(d / pitch);
      if (k >= 1 && k <= 40 && abs(d - k * pitch) <= 0.16 * pitch + 0.015 * k * pitch) {
        for (var t = 1; t < k; t++) run.push(last + d * t / k);
        run.push(q);
        real++;
      } else {
        runs.push(run); reals.push(real);
        run = [q]; real = 1;
      }
    }
    runs.push(run); reals.push(real);
    var bi = 0;
    for (var r = 1; r < runs.length; r++) if (reals[r] > reals[bi] || (reals[r] === reals[bi] && runs[r].length > runs[bi].length)) bi = r;
    var best = runs[bi];
    if (best.length < 2) return null;
    return { pos: best, pitch: (best[best.length - 1] - best[0]) / (best.length - 1), real: reals[bi] };
  }

  function nearestIndex(arr, v) {
    var lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (arr[mid] <= v) lo = mid; else hi = mid; }
    return abs(arr[lo] - v) <= abs(arr[hi] - v) ? lo : hi;
  }
  /** Index i with arr[i] <= v < arr[i+1], or -1. */
  function slotIndex(arr, v) {
    if (v < arr[0] || v >= arr[arr.length - 1]) return -1;
    var lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (arr[mid] <= v) lo = mid; else hi = mid; }
    return lo;
  }

  function buildLattice(comp) {
    if (comp.H.length < 2 || comp.V.length < 2) return null;
    var xs = regularize(positions(comp.V)), ys = regularize(positions(comp.H));
    if (!xs || !ys) return null;
    var X = xs.pos, Y = ys.pos, px = xs.pitch, py = ys.pitch;
    if (X.length < 4 || Y.length < 3) return null;
    if (xs.real < 3 || ys.real < 3) return null;
    if (px < 2.5 || py < 2.5 || px > 45 || py > 45) return null;
    if (px / py > 2.6 || py / px > 2.6) return null;
    var g = { X: X, Y: Y, px: px, py: py, H: comp.H, V: comp.V,
      bb: { x0: X[0], y0: Y[0], x1: X[X.length - 1], y1: Y[Y.length - 1] } };
    // Index the rules by the boundary they sit on.
    g.hAt = []; g.vAt = [];
    for (var i = 0; i < Y.length; i++) g.hAt.push([]);
    for (var j = 0; j < X.length; j++) g.vAt.push([]);
    comp.H.forEach(function (h) {
      var bi = nearestIndex(Y, h.p);
      if (abs(Y[bi] - h.p) <= 0.22 * py) g.hAt[bi].push(h);
    });
    comp.V.forEach(function (v) {
      var bi = nearestIndex(X, v.p);
      if (abs(X[bi] - v.p) <= 0.22 * px) g.vAt[bi].push(v);
    });
    return g;
  }

  function hasRule(list, t) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (list[i].a - 0.35 <= t && t <= list[i].b + 0.35) return true;
    return false;
  }

  /* ================================================================== *
   * 6. Shape descriptors (what is drawn in a cell / a key sample)
   * ================================================================== */

  function onBoundary(v, arr, pitch) {
    var i = nearestIndex(arr, v);
    return abs(arr[i] - v) <= 0.14 * pitch;
  }

  /** True when every edge of a straight stroked prim lies on the lattice. */
  function isLatticePrim(p, g) {
    if (p.curved || !p.stroked) return false;
    if (p.filled && !isWhite(p.fill)) return false;
    var n = p.pts.length, m = p.closed && n > 2 ? n : n - 1;
    if (m < 1) return false;
    for (var k = 0; k < m; k++) {
      var a = p.pts[k], b = p.pts[(k + 1) % n];
      var dx = abs(b[0] - a[0]), dy = abs(b[1] - a[1]);
      var ax = axisOf(a, b);
      if (ax === '0') continue;
      if (ax === 'h') { if (!onBoundary((a[1] + b[1]) / 2, g.Y, g.py) || dx < 0.45 * g.px) return false; }
      else if (ax === 'v') { if (!onBoundary((a[0] + b[0]) / 2, g.X, g.px) || dy < 0.45 * g.py) return false; }
      else return false;
    }
    return true;
  }

  /** A thin filled rule (grid line drawn as a filled rectangle) on the lattice. */
  function isThinLatticeFill(p, g) {
    if (!p.filled || !p.rect) return false;
    var w = bw(p.bb), h = bh(p.bb);
    if (Math.min(w, h) > 1.3) return false;
    if (w >= h) return onBoundary(bcy(p.bb), g.Y, g.py) && w >= 0.45 * g.px;
    return onBoundary(bcx(p.bb), g.X, g.px) && h >= 0.45 * g.py;
  }

  /**
   * A filled region whose outline runs along grid lines: one cell, a run of
   * cells, or an L-shaped block of one colour (colourwork charts).
   */
  function isCellFill(p, g) {
    if (!p.filled || p.curved || p.pts.length < 4) return false;
    var b = p.bb;
    if (bw(b) < 0.7 * g.px || bh(b) < 0.7 * g.py) return false;
    var ek = edgeKinds(p.pts, true);
    for (var i = 0; i < ek.length; i++) if (ek[i] === 'd') return false;
    for (var k = 0; k < p.pts.length; k++) {
      if (!onBoundary(p.pts[k][0], g.X, g.px) || !onBoundary(p.pts[k][1], g.Y, g.py)) return false;
    }
    return true;
  }

  function polyArea(pts) {
    var s = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return abs(s / 2);
  }

  /** Even-odd point in polygon. */
  function inPoly(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  /** A sliver: a fill too thin to be anything but a seam between two fills. */
  function isSliver(p, g) {
    return p.filled && !p.curved && (bw(p.bb) < 0.15 * g.px || bh(p.bb) < 0.15 * g.py);
  }

  /** Coloured straight outline (repeat box, set-up rows, turning point). */
  function isMarkPrim(p, g) {
    if (p.curved || !p.stroked || isNeutral(p.stroke) || lum(p.stroke) > 236) return false;
    if (p.filled && !isWhite(p.fill)) return false;
    var n = p.pts.length, m = p.closed && n > 2 ? n : n - 1;
    for (var k = 0; k < m; k++) {
      var a = p.pts[k], b = p.pts[(k + 1) % n];
      var dx = abs(b[0] - a[0]), dy = abs(b[1] - a[1]);
      if (axisOf(a, b) === 'd') return false;
    }
    return bw(p.bb) >= 0.9 * g.px || bh(p.bb) >= 0.9 * g.py;
  }

  function norm(pt, box) {
    var w = box.x1 - box.x0 || 1, h = box.y1 - box.y0 || 1;
    return [(pt[0] - box.x0) / w, (pt[1] - box.y0) / h];
  }

  function lineItem(a, b) {
    if (a[0] > b[0] + 1e-6 || (abs(a[0] - b[0]) <= 1e-6 && a[1] > b[1])) { var t = a; a = b; b = t; }
    return { k: 'l', u0: a[0], v0: a[1], u1: b[0], v1: b[1] };
  }

  /** Collinear segments that share an endpoint become one (a line drawn in two strokes). */
  function mergeLines(items) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < items.length && !changed; i++) {
        var A = items[i];
        if (A.k !== 'l') continue;
        for (var j = i + 1; j < items.length && !changed; j++) {
          var B = items[j];
          if (B.k !== 'l') continue;
          var pts = [[A.u0, A.v0], [A.u1, A.v1], [B.u0, B.v0], [B.u1, B.v1]];
          var shared = null;
          for (var x = 0; x < 2 && !shared; x++) for (var y = 2; y < 4 && !shared; y++) {
            if (abs(pts[x][0] - pts[y][0]) < 0.03 && abs(pts[x][1] - pts[y][1]) < 0.03) shared = [x, y];
          }
          if (!shared) continue;
          var p = pts[1 - shared[0]], q = pts[5 - shared[1]], s = pts[shared[0]];
          var cross = (s[0] - p[0]) * (q[1] - p[1]) - (s[1] - p[1]) * (q[0] - p[0]);
          var len = hyp(q[0] - p[0], q[1] - p[1]);
          if (len > 0 && abs(cross) / len < 0.02) {
            items[i] = lineItem(p, q);
            items.splice(j, 1);
            changed = true;
          }
        }
      }
    }
  }

  /**
   * Reduce prims + glyph texts drawn inside `box` to a descriptor:
   * { bg: [r,g,b]|null, items: [{k:'l'|'o'|'d'|'a'|'p'|'t', ...}] } in box units.
   */
  function describe(prims, texts, box, bg) {
    var items = [];
    var H = box.y1 - box.y0 || 1;
    // A fill painted over by a later fill of the same colour only shows as its
    // outline: which strand of a cable is on top is the later one.
    prims = prims.map(function (p, i) {
      if (!p.filled || p.curved) return p;
      for (var j = i + 1; j < prims.length; j++) {
        var q = prims[j];
        if (!q.filled || q.curved || colorDist(p.fill, q.fill) > 30) continue;
        var ox = Math.min(p.bb.x1, q.bb.x1) - Math.max(p.bb.x0, q.bb.x0);
        var oy = Math.min(p.bb.y1, q.bb.y1) - Math.max(p.bb.y0, q.bb.y0);
        if (ox > 0.5 * Math.min(bw(p.bb), bw(q.bb)) && oy > 0.5 * Math.min(bh(p.bb), bh(q.bb))) {
          if (!p.stroked) return null;
          var o = copy(p);
          o.filled = false;
          o.fill = null;
          return o;
        }
      }
      return p;
    }).filter(function (p) { return p; });
    prims.forEach(function (p) {
      if (p.curved) {
        var c = norm([bcx(p.bb), bcy(p.bb)], box);
        var r = (bw(p.bb) + bh(p.bb)) / 4 / H;
        var filledDark = p.filled && !isWhite(p.fill);
        if (p.closed || near(p.pts[0], p.pts[p.pts.length - 1], 0.2)) {
          items.push({ k: filledDark || r < 0.06 ? 'd' : 'o', u: c[0], v: c[1], r: r });
        } else {
          var b0 = norm([p.bb.x0, p.bb.y0], box), b1 = norm([p.bb.x1, p.bb.y1], box);
          items.push({ k: 'a', u0: b0[0], v0: b0[1], u1: b1[0], v1: b1[1] });
        }
        return;
      }
      // A "filled" path with no area is a line (a slash painted with fill + stroke).
      var flat = p.filled && (p.pts.length < 3 || polyArea(p.pts) < 0.01 * bw(box) * bh(box) / Math.max(1, Math.round(bw(box) / bh(box))));
      if (p.filled && !flat) {
        items.push({ k: 'p', vs: p.pts.map(function (q) { return norm(q, box); }), c: p.fill });
        if (!p.stroked || !isWhite(p.fill)) return; // the outline of a dark fill adds nothing
      }
      if (p.stroked || flat) {
        var n = p.pts.length, m = p.closed && n > 2 ? n : n - 1;
        for (var k = 0; k < m; k++) {
          var a = norm(p.pts[k], box), b = norm(p.pts[(k + 1) % n], box);
          if (abs(a[0] - b[0]) < 0.02 && abs(a[1] - b[1]) < 0.02) continue;
          items.push(lineItem(a, b));
        }
      }
    });
    (texts || []).forEach(function (t) {
      var c = norm([t.x + t.w / 2, t.y + t.h * 0.35], box);
      items.push({ k: 't', s: t.str, u: c[0], v: c[1] });
    });
    mergeLines(items);
    // the same mark painted twice (fill pass + stroke pass) is one mark
    items = items.filter(function (it, i) {
      for (var j = 0; j < i; j++) if (items[j].k === it.k && it.k !== 'p' && itemCost(items[j], it) < 0.03) return false;
      return true;
    });
    // A ring and a dot in the same place (fill + outline of one circle) are one dot.
    items = items.filter(function (it, i) {
      if (it.k !== 'o') return true;
      for (var j = 0; j < items.length; j++) {
        var d = items[j];
        if (j !== i && d.k === 'd' && abs(d.u - it.u) < 0.08 && abs(d.v - it.v) < 0.08 && abs(d.r - it.r) < 0.08) return false;
      }
      return true;
    });
    return { bg: bg && !isWhite(bg) ? bg : null, items: items };
  }

  function nearestVert(p, vs) {
    var best = Infinity;
    vs.forEach(function (q) { var d = abs(p[0] - q[0]) + abs(p[1] - q[1]); if (d < best) best = d; });
    return best;
  }

  function itemCost(a, b) {
    if (a.k !== b.k) return Infinity;
    if (a.k === 'l') {
      var d1 = abs(a.u0 - b.u0) + abs(a.v0 - b.v0) + abs(a.u1 - b.u1) + abs(a.v1 - b.v1);
      var d2 = abs(a.u0 - b.u1) + abs(a.v0 - b.v1) + abs(a.u1 - b.u0) + abs(a.v1 - b.v0);
      // a slash is not a dash however close their ends are
      var t = abs(Math.atan2(a.v1 - a.v0, a.u1 - a.u0) - Math.atan2(b.v1 - b.v0, b.u1 - b.u0)) % Math.PI;
      if (t > Math.PI / 2) t = Math.PI - t;
      return Math.min(d1, d2) / 2 + 0.6 * t;
    }
    if (a.k === 'o' || a.k === 'd') return abs(a.u - b.u) + abs(a.v - b.v) + 2 * abs(a.r - b.r);
    if (a.k === 'a') return (abs(a.u0 - b.u0) + abs(a.v0 - b.v0) + abs(a.u1 - b.u1) + abs(a.v1 - b.v1)) / 2;
    if (a.k === 't') return a.s === b.s ? 0.1 * (abs(a.u - b.u) + abs(a.v - b.v)) : Infinity;
    if (a.k === 'p') {
      // Hausdorff: one corner far off is a different shape (a cable's front strand)
      var s = 0;
      a.vs.forEach(function (p) { s = Math.max(s, nearestVert(p, b.vs)); });
      b.vs.forEach(function (p) { s = Math.max(s, nearestVert(p, a.vs)); });
      return s + (colorDist(a.c, b.c) > 70 ? 0.6 : 0);
    }
    return Infinity;
  }

  var MATCH_LIMIT = { l: 0.42, o: 0.45, d: 0.45, a: 0.5, t: 0.4, p: 0.35 };

  /** Distance between two descriptors; 0 = identical, each unmatched mark costs 1. */
  function descDistance(A, B) {
    var cost = 0;
    if (colorDist(A.bg, B.bg) > 70) cost += 1.5;
    var used = [];
    var unmatched = 0;
    A.items.forEach(function (a) {
      var best = -1, bestC = Infinity;
      B.items.forEach(function (b, j) {
        if (used[j]) return;
        var c = itemCost(a, b);
        if (c < bestC) { bestC = c; best = j; }
      });
      if (best >= 0 && bestC <= MATCH_LIMIT[a.k]) { used[best] = true; cost += bestC; }
      else unmatched++;
    });
    B.items.forEach(function (b, j) { if (!used[j]) unmatched++; });
    return cost + unmatched;
  }
  function matchLimit(A, B) { return Math.max(0.7, 0.22 * Math.max(A.items.length, B.items.length)); }

  function descKey(d) {
    var q = function (v) { return Math.round(v * 8); };
    var parts = d.items.map(function (it) {
      if (it.k === 'l' || it.k === 'a') return it.k + [it.u0, it.v0, it.u1, it.v1].map(q).join(',');
      if (it.k === 'o' || it.k === 'd') return it.k + [it.u, it.v, it.r].map(q).join(',');
      if (it.k === 't') return 't' + it.s + q(it.u) + ',' + q(it.v);
      return 'p' + it.vs.map(function (v) { return q(v[0]) + '.' + q(v[1]); }).join(',') + hex(it.c);
    }).sort();
    return (d.bg ? hex(d.bg) : '-') + '|' + parts.join(';');
  }

  /* ================================================================== *
   * 7. Key meanings -> stitches
   * ================================================================== */

  var SIMPLE = {
    k: { stitch: 'k', run: 'k', c: 1, p: 1 },
    knit: { stitch: 'k', run: 'k', c: 1, p: 1 },
    p: { stitch: 'p', run: 'p', c: 1, p: 1 },
    purl: { stitch: 'p', run: 'p', c: 1, p: 1 },
    yo: { stitch: 'yo', text: 'yo', c: 0, p: 1 },
    'yarn over': { stitch: 'yo', text: 'yo', c: 0, p: 1 },
    yarnover: { stitch: 'yo', text: 'yo', c: 0, p: 1 },
    k2tog: { stitch: 'k2tog', text: 'k2tog', c: 2, p: 1 },
    k3tog: { stitch: 'k3tog', text: 'k3tog', c: 3, p: 1 },
    p2tog: { stitch: 'p2tog', text: 'p2tog', c: 2, p: 1 },
    p3tog: { stitch: 'p3tog', text: 'p3tog', c: 3, p: 1 },
    ssk: { stitch: 'ssk', text: 'ssk', c: 2, p: 1 },
    ssp: { stitch: 'ssp', text: 'ssp', c: 2, p: 1 },
    sssk: { stitch: 'sssk', text: 'sssk', c: 3, p: 1 },
    skp: { stitch: 'skp', text: 'skp', c: 2, p: 1 },
    sk2p: { stitch: 'sk2p', text: 'sk2p', c: 3, p: 1 },
    s2kp: { stitch: 'cdd', text: 's2kp', c: 3, p: 1 },
    s2kp2: { stitch: 'cdd', text: 's2kp2', c: 3, p: 1 },
    cdd: { stitch: 'cdd', text: 'cdd', c: 3, p: 1 },
    m1: { stitch: 'm1', text: 'M1', c: 0, p: 1 },
    m1l: { stitch: 'm1', text: 'M1L', c: 0, p: 1 },
    m1r: { stitch: 'm1', text: 'M1R', c: 0, p: 1 },
    kfb: { stitch: 'kfb', text: 'kfb', c: 1, p: 2 },
    'k1f&b': { stitch: 'kfb', text: 'kfb', c: 1, p: 2 },
    k1fb: { stitch: 'kfb', text: 'kfb', c: 1, p: 2 },
    pfb: { stitch: 'pfb', text: 'pfb', c: 1, p: 2 },
    'k tbl': { stitch: 'ktbl', run: 'ktbl', c: 1, p: 1 },
    'k1 tbl': { stitch: 'ktbl', run: 'ktbl', c: 1, p: 1 },
    'p tbl': { stitch: 'ptbl', run: 'ptbl', c: 1, p: 1 },
    'p1 tbl': { stitch: 'ptbl', run: 'ptbl', c: 1, p: 1 },
    mb: { stitch: 'mb', text: 'MB', c: 1, p: 1 },
    bobble: { stitch: 'mb', text: 'MB', c: 1, p: 1 },
    'make bobble': { stitch: 'mb', text: 'MB', c: 1, p: 1 },
    'sl 1': { stitch: 'sl', run: 'sl', c: 1, p: 1 },
    sl1: { stitch: 'sl', run: 'sl', c: 1, p: 1 },
    'slip 1': { stitch: 'sl', run: 'sl', c: 1, p: 1 },
    sl: { stitch: 'sl', run: 'sl', c: 1, p: 1 }
  };

  /** Stitches a written sequence consumes and produces, or null when unsure. */
  function countSequence(text) {
    var s = String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[\[\]]/g, ' ')
      .replace(/,?\s*hold (in )?(front|back)( of work)?,?/g, ',').replace(/\s+/g, ' ').trim();
    if (/\bin(to)? (the )?(next|same) st/.test(s)) {
      var made = 0, ok = true;
      s.replace(/\s*\bin(to)? (the )?(next|same) st.*$/, '').split(/[,;]/).forEach(function (part) {
        part = part.trim();
        if (!part) return;
        var m = /^(k|p|yo)(\d*)(?: tbl)?$/.exec(part);
        if (m) made += m[1] === 'yo' ? 1 : (+m[2] || 1); else ok = false;
      });
      return ok && made ? { c: 1, p: made } : null;
    }
    var c = 0, p = 0, good = true, any = false;
    s.split(/[,;]|\band\b|\bthen\b/).forEach(function (raw) {
      var part = raw.trim();
      if (!part || !good) return;
      if (/^hold (in )?(front|back)( of work)?$/.test(part)) return;
      any = true;
      var m;
      if ((m = /^(k|p)(\d+)(?: tbl)? from (the )?cn$/.exec(part))) { p += +m[2]; return; }
      if ((m = /^sl (\d+) (?:sts? )?(?:onto |to )(?:the )?cn(?:,? hold (?:in )?(?:front|back))?$/.exec(part))) { c += +m[1]; return; }
      if ((m = /^(?:sl|slip) (\d+)(?: sts?)?(?: (?:k|p)wise| as if to (?:k|p)\w*| wy[if]b)*$/.exec(part))) { c += +m[1]; p += +m[1]; return; }
      if ((m = /^(k|p)(\d+)(?: tbl)?$/.exec(part))) { c += +m[2]; p += +m[2]; return; }
      if ((m = /^(k|p)(\d)tog(?: tbl)?$/.exec(part))) { c += +m[2]; p += 1; return; }
      if (/^(ssk|ssp|skp)$/.test(part)) { c += 2; p += 1; return; }
      if (/^sssk$/.test(part)) { c += 3; p += 1; return; }
      if (/^(yo|m1[lr]?)$/.test(part)) { p += 1; return; }
      if (/^(psso|ppso|pass (the )?(slipped|purled) st over)$/.test(part)) { p -= 1; return; }
      if (/^(p2sso|pass (the )?2 slipped sts over)$/.test(part)) { p -= 2; return; }
      good = false;
    });
    return good && any ? { c: c, p: p } : null;
  }

  function cleanMeaning(s) {
    return String(s || '')
      .replace(/\((see|refer)[^)]*\)?/ig, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[\s.:]+$/, '')
      .trim();
  }

  function fillSpec(out, spec) {
    out.stitch = spec.stitch;
    out.run = spec.run || null;
    out.text = spec.text || null;
    out.consumes = spec.c;
    out.produces = spec.p;
    if (spec.suffix) out.suffix = spec.suffix;
    return out;
  }

  /**
   * One key meaning -> { kind, stitch, text, run, consumes, produces, color, rs, ws, w, cross }.
   * kind: 'stitch' | 'nostitch' | 'repeat' | 'setup' | 'marker' | 'note'.
   */
  function parseMeaning(meaning, cells) {
    var m0 = cleanMeaning(meaning);
    var low = m0.toLowerCase();
    var out = { meaning: m0, kind: 'stitch', stitch: null, text: null, run: null, consumes: null, produces: null, color: null };
    if (!low) { out.kind = 'note'; return out; }
    if (/\bno st(itch)?\b/.test(low)) { out.kind = 'nostitch'; out.stitch = 'nostitch'; out.text = ''; out.consumes = 0; out.produces = 0; return out; }
    if (/\brepeat\b|\brep\b/.test(low) && !/\b[kp]\d|\bk2tog|\bssk|\byo\b/.test(low)) {
      out.kind = 'repeat';
      var sz = /(\d+)\s*sts?\b/.exec(low);
      out.only = /\bfor sizes?\b|\bsizes? worked\b/.test(low);
      if (sz) out.sizeSts = +sz[1];
      return out;
    }
    if (/set-?up rows?/.test(low)) { out.kind = 'setup'; return out; }
    if (/\bmarker\b|\bpm\b/.test(low) && low.length < 30) { out.kind = 'marker'; return out; }
    if (/turning point|\bcenter\b|\bcentre\b|\bwork as given\b/.test(low) && !/\b[kp]\d|tog\b|\byo\b/.test(low)) { out.kind = 'note'; return out; }

    // Side-dependent: "k on RS; p on WS"
    var sd = /^(.+?)\s+on\s+rs\b[\s;,]*(.+?)\s+on\s+ws\b/.exec(low);
    if (sd) {
      out.rs = parseMeaning(sd[1], cells);
      out.ws = parseMeaning(sd[2], cells);
      out.stitch = out.rs.stitch;
      out.text = out.rs.text;
      out.run = out.rs.run;
      out.consumes = out.rs.consumes;
      out.produces = out.rs.produces;
      return out;
    }
    // Colourwork: "With MC, knit" / "MC" / "CC1"
    var cw = /^with\s+([a-z]{1,3}\d*)\s*,\s*(.+)$/.exec(low);
    if (cw && /^(mc|cc\d*|ac\d*|[a-d])$/.test(cw[1])) {
      var inner = parseMeaning(cw[2], cells);
      inner.meaning = m0;
      inner.color = cw[1].toUpperCase();
      return inner;
    }
    if (/^(mc|cc\d*|ac\d*|main colou?r|contrast(ing)? colou?r( ?\d+)?)$/.test(low)) {
      var col = low.replace(/main colou?r/, 'mc').replace(/contrast(ing)? colou?r ?/, 'cc');
      out.stitch = 'k'; out.run = 'k'; out.consumes = 1; out.produces = 1; out.color = col.toUpperCase();
      return out;
    }
    var key = low.replace(/[.\s]+$/, '').replace(/\s+/g, ' ');
    if (SIMPLE[key]) return fillSpec(out, SIMPLE[key]);
    if (/^(sl 1,? k2tog,? psso|slip 1,? k2tog,? psso|sl1,? k2tog,? psso)$/.test(key)) return fillSpec(out, { stitch: 'sk2p', text: 'sl 1, k2tog, psso', c: 3, p: 1 });
    if (/^(sl 1,? k1,? psso|slip 1,? knit 1,? psso|sl1,? k1,? psso)$/.test(key)) return fillSpec(out, { stitch: 'skp', text: 'sl 1, k1, psso', c: 2, p: 1 });
    if (/^sl(ip)? 2\b.*\bk1\b.*\b(p2sso|pass (the )?2 slipped sts over)$|centered double|centred double/.test(key)) return fillSpec(out, { stitch: 'cdd', text: 'cdd', c: 3, p: 1 });
    if (/^(knit|k) (1 )?(through|thru) (the )?back loop$/.test(key)) return fillSpec(out, SIMPLE['k tbl']);
    if (/^(purl|p) (1 )?(through|thru) (the )?back loop$/.test(key)) return fillSpec(out, SIMPLE['p tbl']);
    if (/^make one( left)?$/.test(key)) return fillSpec(out, SIMPLE.m1);
    if (/^(slip|sl) 1 (st )?(purlwise|pwise|knitwise|kwise)( wy[ib]f| with yarn in (front|back))?$/.test(key)) {
      return fillSpec(out, { stitch: 'sl', run: 'sl', c: 1, p: 1, suffix: ' ' + key.replace(/^(slip|sl) 1 (st )?/, '') });
    }

    // Cables: "sl 2 sts to cn, hold in back, k2, k2 from cn"
    if (/\bcn\b|cable needle/.test(key) && /hold (in )?(front|back)/.test(key)) {
      var cross = /hold (in )?front/.test(key) ? 'F' : 'B';
      var cnt = countSequence(key);
      var plain = /^sl (\d) sts? to cn,? hold (in )?(front|back),? k(\d),? k(\d) from cn$/.exec(key);
      out.stitch = 'cable';
      out.cross = cross;
      out.consumes = cnt ? cnt.c : null;
      out.produces = cnt ? cnt.p : null;
      out.w = cnt && cnt.c === cnt.p ? cnt.c : (cells || null);
      if (plain && +plain[1] === +plain[5]) {
        out.w = +plain[4] + +plain[5];
        out.text = 'C' + out.w + cross;
      } else {
        out.text = '[' + m0 + ']';
      }
      return out;
    }
    // Anything else stitch-like is written the way the key words it.
    var seq = countSequence(key);
    out.text = /,/.test(m0) && m0.length > 24 ? '[' + m0 + ']' : m0;
    if (seq) { out.consumes = seq.c; out.produces = seq.p; }
    else if (!/\b(k|p|yo|tog|sl|ssk|knit|purl|st|sts)\b|\b[kp]\d/i.test(m0)) out.kind = 'note';
    return out;
  }

  /* ================================================================== *
   * 8. The key (legend) on a page
   * ================================================================== */

  function insideAny(b, grids, pad) {
    for (var i = 0; i < grids.length; i++) {
      var g = grids[i].bb;
      if (bcx(b) >= g.x0 - pad && bcx(b) <= g.x1 + pad && bcy(b) >= g.y0 - pad && bcy(b) <= g.y1 + pad) return true;
    }
    return false;
  }

  /** The sample's descriptor: a box outline frames it; else its own bbox does. */
  function sampleDescriptor(smp, pitch) {
    var prims = smp.prims, bb = smp.bb, frame = null;
    prims.forEach(function (p) {
      if (!p.boxLike) return;
      if (bw(p.bb) >= 0.85 * bw(bb) && bh(p.bb) >= 0.85 * bh(bb)) {
        if (!frame || bw(p.bb) * bh(p.bb) > bw(frame.bb) * bh(frame.bb)) frame = p;
      }
    });
    var box = frame ? frame.bb : bb;
    var bg = frame && frame.filled ? frame.fill : null;
    var content = prims.filter(function (p) {
      if (p === frame) return false;
      if (p.filled && p.rect && bw(p.bb) >= 0.8 * bw(box) && bh(p.bb) >= 0.8 * bh(box)) { bg = p.fill; return false; }
      // the box drawn again as a plain outline
      if (p.boxLike && abs(bw(p.bb) - bw(box)) < 0.8 && abs(bh(p.bb) - bh(box)) < 0.8) return false;
      return true;
    });
    if (!frame && bw(box) < 0.7 * pitch && bh(box) < 0.7 * pitch) {
      var cx = bcx(box), cy = bcy(box);
      box = { x0: cx - pitch / 2, x1: cx + pitch / 2, y0: cy - pitch / 2, y1: cy + pitch / 2 };
    }
    var d = describe(content, smp.texts, box, bg);
    var markColor = null, mark = false;
    if (frame && !content.length && !smp.texts.length && frame.stroked && !isNeutral(frame.stroke) && !(frame.filled && !isWhite(frame.fill))) {
      mark = true;
      markColor = frame.stroke;
    } else if (!frame && content.length && content.every(function (p) { return p.stroked && !p.filled && !isNeutral(p.stroke) && !p.curved; })) {
      // a coloured bar ("turning point", "marker position")
      mark = true;
      markColor = content[0].stroke;
    }
    var cells = Math.max(1, Math.round(bw(box) / Math.max(bh(box), 0.01)));
    return { d: d, cells: cells, mark: mark, markColor: markColor };
  }

  /**
   * Key entries: a sample (box with the symbol, or the bare symbol) with its
   * meaning printed to the right. Continuation lines below join the meaning.
   */
  function findLegend(lines, prims, texts, grids, pitch) {
    if (!(pitch > 0)) return [];
    var cand = prims.filter(function (p) {
      if (insideAny(p.bb, grids, 0.2 * pitch)) return false;
      return bh(p.bb) <= 2.8 * pitch && bw(p.bb) <= 7 * pitch && (bw(p.bb) > 0.2 || bh(p.bb) > 0.2);
    });
    var glyphs = texts.filter(function (t) {
      return t.str.length <= 2 && !insideAny({ x0: t.x, x1: t.x + t.w, y0: t.y, y1: t.y + t.h }, grids, 0.2 * pitch);
    });
    var glyphPrims = glyphs.map(function (t) {
      return { glyph: t, bb: { x0: t.x, x1: t.x + t.w, y0: t.y, y1: t.y + t.h * 0.7 } };
    });
    var samples = [];
    var seedOwner = [];
    lines.forEach(function (ln, li) {
      ln.sample = null;
      if (!/[a-z]/i.test(cleanMeaning(ln.text)) || ln.text.length > 140) return;
      if (glyphish(ln.items)) return;
      if (insideAny({ x0: ln.x0, x1: ln.x1, y0: ln.y, y1: ln.y + ln.h }, grids, 0)) return;
      var cy = ln.cy, right = ln.x0;
      // A word alone beside a meaning is an abbreviation table ("BO  bind off"),
      // not a key: only a symbol glyph can stand alone as a sample.
      var nearBy = cand.concat(glyphPrims.filter(function (gp) { return !/[a-z]/i.test(gp.glyph.str) && !/^[*()\[\]]+$/.test(gp.glyph.str); })).filter(function (p) {
        return p.bb.x1 <= right + 0.4 && p.bb.x1 >= right - 2.6 * pitch &&
          abs(bcy(p.bb) - cy) <= Math.max(0.75 * pitch, 0.6 * bh(p.bb));
      });
      if (!nearBy.length) return;
      // Seed: the prim closest to the text; grow while neighbours touch.
      nearBy.sort(function (a, b) { return b.bb.x1 - a.bb.x1; });
      var seed = nearBy[0];
      // One sample, one meaning: the line whose middle is nearest the sample keeps it.
      for (var so = 0; so < seedOwner.length; so++) {
        if (seedOwner[so].seed === seed) {
          var other = seedOwner[so];
          if (abs(bcy(seed.bb) - other.cy) <= abs(bcy(seed.bb) - cy)) return;
          lines[other.li].sample = null;
          samples.splice(samples.indexOf(other.smp), 1);
          seedOwner.splice(so, 1);
          break;
        }
      }
      var box = unionBox(null, seed.bb);
      var members = seed.glyph ? [] : [seed];
      var grew = true;
      while (grew) {
        grew = false;
        cand.forEach(function (p) {
          if (members.indexOf(p) >= 0) return;
          if (p.bb.x1 > right + 0.4) return;
          if (!boxesTouch(p.bb, box, 0.3 * pitch)) return;
          var nb = unionBox(box, p.bb);
          if (bh(nb) > 2.8 * pitch || bw(nb) > 7 * pitch) return;
          if (abs(bcy(p.bb) - bcy(box)) > 0.6 * Math.max(bh(box), pitch)) return;
          members.push(p);
          box = nb;
          grew = true;
        });
      }
      var gl = glyphs.filter(function (t) {
        var tb = { x0: t.x, x1: t.x + t.w, y0: t.y, y1: t.y + t.h * 0.7 };
        return tb.x1 <= right + 0.4 && bcx(tb) >= box.x0 - 0.1 * pitch && bcx(tb) <= box.x1 + 0.1 * pitch &&
          bcy(tb) >= box.y0 - 0.2 * pitch && bcy(tb) <= box.y1 + 0.2 * pitch;
      });
      var smp = { line: li, prims: members, texts: gl, bb: box };
      samples.push(smp);
      seedOwner.push({ seed: seed, li: li, cy: cy, smp: smp });
      ln.sample = smp;
    });

    var entries = [];
    samples.forEach(function (smp) {
      var ln = lines[smp.line];
      var text = ln.text;
      var lastY = ln.y, h = ln.h;
      // a tall sample (a coloured box beside two lines) owns the lines above it too
      var up = lines.filter(function (l) {
        return !l.sample && abs(l.x0 - ln.x0) <= 1.6 && l.y > ln.y && l.y - ln.y <= 1.8 * h * 2 &&
          l.cy >= smp.bb.y0 - 0.3 * h && l.cy <= smp.bb.y1 + 0.3 * h;
      }).sort(function (a, b) { return a.y - b.y; });
      var topY = ln.y;
      for (var u = 0; u < up.length; u++) {
        if (up[u].y - topY > 1.8 * h) break;
        text = up[u].text + ' ' + text;
        topY = up[u].y;
      }
      // continuation lines: same left edge, just below, no sample of their own
      var cont = lines.filter(function (l, i) {
        return i !== smp.line && abs(l.x0 - ln.x0) <= 1.6 && l.y < ln.y && !l.sample;
      }).sort(function (a, b) { return b.y - a.y; });
      for (var k = 0; k < cont.length; k++) {
        var c = cont[k];
        if (lastY - c.y > 1.8 * h) break;
        var blocked = samples.some(function (s) { var sl = lines[s.line]; return sl.y < lastY - 0.1 && sl.y > c.y + 0.1 && abs(sl.x0 - ln.x0) < 30; });
        if (blocked) break;
        text += ' ' + c.text;
        lastY = c.y;
      }
      var sd = sampleDescriptor(smp, pitch);
      entries.push({ meaning: cleanMeaning(text), raw: ln.text, desc: sd.d, w: sd.cells, color: sd.markColor, mark: sd.mark, bb: smp.bb });
    });
    return entries;
  }

  /* ================================================================== *
   * 9. Vector charts
   * ================================================================== */

  function vectorGrids(prims) {
    var rules = rulesOf(prims).filter(isGridRule);
    var H = mergeRules(rules.filter(function (r) { return r.o === 'h'; }));
    var V = mergeRules(rules.filter(function (r) { return r.o === 'v'; }));
    var grids = [];
    components(H, V).forEach(function (comp) {
      if (comp.H.length < 3 || comp.V.length < 3) return;
      var g = buildLattice(comp);
      if (g) grids.push(g);
    });
    // A lattice nested in another one is part of it, not a chart of its own.
    return grids.filter(function (g, i) {
      return !grids.some(function (o, j) {
        return j !== i && bw(o.bb) * bh(o.bb) > bw(g.bb) * bh(g.bb) && o.bb.x0 <= g.bb.x0 + 0.5 && o.bb.x1 >= g.bb.x1 - 0.5 && o.bb.y0 <= g.bb.y0 + 0.5 && o.bb.y1 >= g.bb.y1 - 0.5;
      });
    });
  }

  /** Cells, glyph units and their descriptors for one lattice. */
  function readCells(g, prims, texts) {
    var X = g.X, Y = g.Y, nr = Y.length - 1, nc = X.length - 1;
    var bg = [], present = [], edges = [];
    var r, c;
    for (r = 0; r < nr; r++) {
      bg.push([]); present.push([]); edges.push([]);
      for (c = 0; c < nc; c++) { bg[r].push(undefined); present[r].push(false); edges[r].push(0); }
    }
    var mine = [], marks = [];
    prims.forEach(function (p) {
      var cx = bcx(p.bb), cy = bcy(p.bb);
      var inside = cx >= g.bb.x0 - 0.1 && cx <= g.bb.x1 + 0.1 && cy >= g.bb.y0 - 0.1 && cy <= g.bb.y1 + 0.1;
      if (isMarkPrim(p, g)) {
        if (boxesTouch(p.bb, g.bb, 0.5 * g.px)) marks.push(p);
        return;
      }
      if (!inside) return;
      if (isLatticePrim(p, g) || isThinLatticeFill(p, g)) return;
      if (isCellFill(p, g)) {
        var c0 = nearestIndex(X, p.bb.x0), c1 = nearestIndex(X, p.bb.x1), r0 = nearestIndex(Y, p.bb.y0), r1 = nearestIndex(Y, p.bb.y1);
        for (var rr = r0; rr < r1; rr++) for (var cc = c0; cc < c1; cc++) {
          if (p.rect || inPoly((X[cc] + X[cc + 1]) / 2, (Y[rr] + Y[rr + 1]) / 2, p.pts)) bg[rr][cc] = isWhite(p.fill) ? null : p.fill;
        }
        return;
      }
      if (isSliver(p, g)) return;
      if (p.filled && bw(p.bb) >= 0.9 * bw(g.bb) && bh(p.bb) >= 0.9 * bh(g.bb)) return; // backdrop
      if (bh(p.bb) > 1.35 * g.py) return;
      mine.push(p);
    });
    // presence from drawn edges
    for (r = 0; r < nr; r++) {
      var ym = (Y[r] + Y[r + 1]) / 2;
      for (c = 0; c < nc; c++) {
        var xm = (X[c] + X[c + 1]) / 2;
        var top = hasRule(g.hAt[r + 1], xm), bottom = hasRule(g.hAt[r], xm);
        var left = hasRule(g.vAt[c], ym), right = hasRule(g.vAt[c + 1], ym);
        edges[r][c] = (top ? 1 : 0) + (bottom ? 1 : 0) + (left ? 1 : 0) + (right ? 1 : 0);
        present[r][c] = edges[r][c] === 4 || (bg[r][c] != null);
      }
    }
    // spans (cables): prims wider than a cell
    var spans = [];
    for (r = 0; r < nr; r++) spans.push([]);
    var placed = [];
    mine.forEach(function (p) {
      var rr = slotIndex(Y, bcy(p.bb));
      if (rr < 0) return;
      if (bw(p.bb) > 1.35 * g.px) {
        var s0 = Math.max(0, Math.round((p.bb.x0 - X[0]) / g.px));
        var s1 = Math.min(nc - 1, Math.round((p.bb.x1 - X[0]) / g.px) - 1);
        if (s1 > s0) {
          var merged = false;
          spans[rr].forEach(function (s) {
            if (!merged && s0 <= s.c1 && s1 >= s.c0) { s.c0 = Math.min(s.c0, s0); s.c1 = Math.max(s.c1, s1); s.prims.push(p); merged = true; }
          });
          if (!merged) spans[rr].push({ c0: s0, c1: s1, prims: [p], texts: [] });
          return;
        }
      }
      var cc = slotIndex(X, bcx(p.bb));
      if (cc < 0) return;
      placed.push({ p: p, r: rr, c: cc });
    });
    var cellPrims = [];
    for (r = 0; r < nr; r++) { cellPrims.push([]); for (c = 0; c < nc; c++) cellPrims[r].push({ prims: [], texts: [] }); }
    function spanFor(rr, cc) {
      var hit = null;
      spans[rr].forEach(function (s) { if (cc >= s.c0 && cc <= s.c1) hit = s; });
      return hit;
    }
    placed.forEach(function (o) {
      var span = spanFor(o.r, o.c);
      if (span) span.prims.push(o.p); else cellPrims[o.r][o.c].prims.push(o.p);
    });
    texts.forEach(function (t) {
      var rr = slotIndex(Y, t.y + t.h * 0.35), cc = slotIndex(X, t.x + t.w / 2);
      if (rr < 0 || cc < 0 || t.w > 1.4 * g.px) return;
      var span = spanFor(rr, cc);
      if (span) span.texts.push(t);
      // a row number printed beside a stepped edge is not a cell
      else if (present[rr][cc]) cellPrims[rr][cc].texts.push(t);
    });
    // glyph units: one per cell, one per span
    var units = [];
    for (r = 0; r < nr; r++) {
      var spanAt = {};
      spans[r].forEach(function (s) {
        s.prims.sort(function (a, b) { return a.z - b.z; });
        var box = { x0: X[s.c0], x1: X[s.c1 + 1], y0: Y[r], y1: Y[r + 1] };
        var u = { r: r, c0: s.c0, c1: s.c1, desc: describe(s.prims, s.texts, box, bg[r][s.c0]) };
        units.push(u);
        for (var k = s.c0; k <= s.c1; k++) { spanAt[k] = u; present[r][k] = true; }
      });
      for (c = 0; c < nc; c++) {
        if (spanAt[c]) continue;
        var cp = cellPrims[r][c];
        // three drawn edges and a symbol inside is a cell; three edges alone is the
        // notch beside a stepped row
        if (!present[r][c] && !(cp.prims.length && edges[r][c] >= 3)) continue;
        cp.prims.sort(function (a, b) { return a.z - b.z; });
        var cbox = { x0: X[c], x1: X[c + 1], y0: Y[r], y1: Y[r + 1] };
        units.push({ r: r, c0: c, c1: c, desc: describe(cp.prims, cp.texts, cbox, bg[r][c]) });
      }
    }
    return { units: units, marks: marks, nr: nr, nc: nc };
  }

  /* ================================================================== *
   * 10. Row numbers, title, repeats
   * ================================================================== */

  function rowExtent(units, r) {
    var lo = Infinity, hi = -Infinity;
    units.forEach(function (u) { if (u.r === r) { if (u.c0 < lo) lo = u.c0; if (u.c1 > hi) hi = u.c1; } });
    return lo <= hi ? { lo: lo, hi: hi } : null;
  }

  function readRowLabels(g, units, nr, texts) {
    var X = g.X, Y = g.Y, pairs = [];
    var ext = [];
    for (var r = 0; r < nr; r++) ext.push(rowExtent(units, r));
    texts.forEach(function (t) {
      var m = /^(\d{1,3})\s*\*?$/.exec(t.str);
      if (!m) return;
      var cy = t.y + t.h * 0.35;
      var rr = slotIndex(Y, cy);
      if (rr < 0) return;
      var mid = (Y[rr] + Y[rr + 1]) / 2;
      if (abs(cy - mid) > 0.42 * g.py) return;
      var e = ext[rr];
      if (!e) return;
      var xr = X[e.hi + 1], xl = X[e.lo];
      var side = null;
      if (t.x >= xr - 0.3 && t.x <= xr + 3.2 * g.px) side = 'right';
      else if (t.x + t.w <= xl + 0.3 && t.x + t.w >= xl - 3.2 * g.px) side = 'left';
      if (!side) return;
      pairs.push({ r: rr, n: +m[1], side: side });
    });
    // fit n = start + step * r (step 1 or 2): most rows explained wins
    var best = null;
    [1, 2].forEach(function (step) {
      pairs.forEach(function (p) {
        var start = p.n - step * p.r;
        if (start < 0) return;
        var rows = {};
        var inl = pairs.filter(function (q) { return q.n === start + step * q.r; });
        inl.forEach(function (q) { rows[q.r] = 1; });
        var score = Object.keys(rows).length;
        if (!best || score > best.score || (score === best.score && step < best.step)) best = { start: start, step: step, score: score, inl: inl };
      });
    });
    if (!best) return { start: 1, step: 1, guessed: true, sides: {} };
    var sides = {};
    best.inl.forEach(function (q) { sides[q.n] = q.side; });
    return { start: best.start, step: best.step, guessed: best.score < 2, sides: sides };
  }

  function findTitle(g, lines, skip) {
    var best = null, bestD = Infinity;
    lines.forEach(function (ln) {
      if (skip && skip[ln.text]) return;
      if (!/[a-z]/i.test(ln.text)) return;
      if (/^\d+\s*(sts?|st rep(eat)?)\b/i.test(ln.text) || /^(pattern )?repeat$/i.test(ln.text)) return;
      var d = ln.y - g.bb.y1;
      // a stepped chart's title can sit beside its narrower top rows
      if (d < -1.1 * ln.h || d > Math.max(40, 4 * g.py)) return;
      if (ln.x1 < g.bb.x0 - 30 || ln.x0 > g.bb.x1) return;
      if (ln.text.length > 80) return;
      var score = d < 0 ? -d * 2 : d;
      if (score < bestD) { bestD = score; best = ln; }
    });
    return best ? best.text.replace(/\s*\*$/, '') : null;
  }

  function colsOf(g, x0, x1) {
    var c0 = Math.max(0, Math.round((x0 - g.X[0]) / g.px));
    var c1 = Math.min(g.X.length - 2, Math.round((x1 - g.X[0]) / g.px) - 1);
    return { c0: c0, c1: c1 };
  }

  /** Coloured outlines on the chart: repeat boxes, set-up rows, markers. */
  function readMarks(g, markPrims, legend, nr, pageHasRepeatWord) {
    var byColor = {};
    markPrims.forEach(function (p) {
      var key = hex(p.stroke);
      (byColor[key] = byColor[key] || { color: p.stroke, prims: [] }).prims.push(p);
    });
    var out = [];
    Object.keys(byColor).forEach(function (key) {
      var grp = byColor[key];
      var leg = null;
      legend.forEach(function (e) { if (!leg && e.mark && e.color && colorDist(e.color, grp.color) < 60) leg = e; });
      var info = leg ? parseMeaning(leg.meaning) : null;
      var kind = info ? info.kind : (pageHasRepeatWord ? 'repeat' : 'mark');
      if (kind === 'stitch' || kind === 'nostitch') kind = 'mark';
      var vs = [];
      grp.prims.forEach(function (p) {
        var n = p.pts.length, m = p.closed && n > 2 ? n : n - 1;
        for (var k = 0; k < m; k++) {
          var a = p.pts[k], b = p.pts[(k + 1) % n];
          if (axisOf(a, b) === 'v') vs.push({ x: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) });
        }
      });
      var rowsCols = {};
      for (var r = 0; r < nr; r++) {
        var ym = (g.Y[r] + g.Y[r + 1]) / 2;
        var xsr = vs.filter(function (v) { return v.y0 <= ym && v.y1 >= ym; }).map(function (v) { return v.x; }).sort(function (a, b) { return a - b; });
        if (xsr.length >= 2 && xsr[xsr.length - 1] - xsr[0] >= 0.6 * g.px) rowsCols[r] = colsOf(g, xsr[0], xsr[xsr.length - 1]);
      }
      var rs = Object.keys(rowsCols).map(Number);
      if (!rs.length) {
        out.push({ kind: kind === 'repeat' ? 'mark' : kind, color: hex(grp.color), label: leg ? leg.meaning : null });
        return;
      }
      var r0 = Math.min.apply(null, rs), r1 = Math.max.apply(null, rs);
      var c0 = Infinity, c1 = -Infinity, same = true, first = rowsCols[r0];
      rs.forEach(function (rr) {
        var cc = rowsCols[rr];
        if (cc.c0 < c0) c0 = cc.c0;
        if (cc.c1 > c1) c1 = cc.c1;
        if (cc.c0 !== first.c0 || cc.c1 !== first.c1) same = false;
      });
      var mk = { kind: kind, color: hex(grp.color), label: leg ? leg.meaning : null, c0: c0, c1: c1, r0: r0, r1: r1 };
      if (!same) mk.byRow = rowsCols;
      if (info && info.only) mk.only = true;
      if (info && info.sizeSts) mk.sizeSts = info.sizeSts;
      out.push(mk);
    });
    return out;
  }

  /** "Repeat" written under the chart with a bracket line above it. */
  function readBrackets(g, lines, prims, nc) {
    var out = [];
    lines.forEach(function (ln) {
      var m = /^(?:pattern )?repeat$|^(\d+)[- ]?st(?:itche)?s? rep(?:eat)?$/i.exec(ln.text);
      if (!m) return;
      var below = g.bb.y0 - (ln.y + ln.h);
      if (below < -0.5 || below > 7 * g.py) return;
      var cx = (ln.x0 + ln.x1) / 2;
      if (cx < g.bb.x0 - g.px || cx > g.bb.x1 + g.px) return;
      var br = null;
      prims.forEach(function (p) {
        if (p.curved || !p.stroked) return;
        if (p.bb.y1 > g.bb.y0 - 0.25 * g.py || p.bb.y0 < ln.y + ln.h - 0.5) return;
        if (p.bb.x0 > cx || p.bb.x1 < cx) return;
        if (bw(p.bb) < 1.5 * g.px || bh(p.bb) > 1.6 * g.py) return;
        if (!br || bw(p.bb) > bw(br.bb)) br = p;
      });
      if (br) {
        var cc = colsOf(g, br.bb.x0, br.bb.x1);
        out.push({ kind: 'repeat', c0: cc.c0, c1: cc.c1, r0: 0, r1: g.Y.length - 2, label: ln.text, bracket: true });
      } else if (m[1] && +m[1] === nc) {
        out.push({ kind: 'repeat', c0: 0, c1: nc - 1, r0: 0, r1: g.Y.length - 2, label: ln.text });
      } else if (m[1]) {
        out.push({ kind: 'repeatWidth', sts: +m[1], label: ln.text });
      }
    });
    return out;
  }

  /* ================================================================== *
   * 11. Matching cells to the key
   * ================================================================== */

  /** u.entry = the key entry (or an unknown cluster) each unit matches. */
  function assignSyms(units, legend) {
    var cache = {};
    var unknown = [];
    units.forEach(function (u) {
      var width = u.c1 - u.c0 + 1;
      var key = descKey(u.desc) + '#' + width;
      var hit = cache[key];
      if (hit === undefined) {
        var best = null, bestD = Infinity;
        legend.forEach(function (e) {
          if (e.mark || !e.desc) return;
          var d = descDistance(u.desc, e.desc);
          if (width > 1 && e.w && e.w !== width) d += 0.6;
          if (width === 1 && e.w > 1) d += 0.6;
          if (d < bestD) { bestD = d; best = e; }
        });
        if (best && bestD <= matchLimit(u.desc, best.desc)) hit = best;
        else {
          hit = null;
          for (var i = 0; i < unknown.length && !hit; i++) {
            if (unknown[i].w === width && descDistance(u.desc, unknown[i].desc) <= matchLimit(u.desc, unknown[i].desc)) hit = unknown[i];
          }
          if (!hit) {
            hit = { sym: '?' + (unknown.length + 1), desc: u.desc, w: width, unknown: true };
            unknown.push(hit);
          }
        }
        cache[key] = hit;
      }
      u.entry = hit;
    });
    return unknown;
  }

  /* ================================================================== *
   * 12. Glyph charts (symbol font, no vector grid)
   * ================================================================== */

  /**
   * Glyph charts: a symbol font whose characters sit on a regular grid. A run of
   * symbols set as one text item is split evenly into its characters; a single
   * character as wide as several cells (a cable glyph) spans them.
   */
  function glyphGrids(texts) {
    var inkByFont = {}, body = null;
    texts.forEach(function (t) { inkByFont[t.font] = (inkByFont[t.font] || 0) + t.str.length; });
    Object.keys(inkByFont).forEach(function (f) { if (!body || inkByFont[f] > inkByFont[body]) body = f; });
    var byFont = {};
    texts.forEach(function (t) {
      if (/\s/.test(t.str) || t.str.length > 120) return;
      var list = byFont[t.font] = byFont[t.font] || [];
      if (t.str.length === 1) { list.push(t); return; }
      var per = t.w / t.str.length;
      for (var i = 0; i < t.str.length; i++) {
        list.push({ str: t.str.charAt(i), x: t.x + i * per, y: t.y, w: per, h: t.h, font: t.font, split: true });
      }
    });
    var out = [];
    Object.keys(byFont).forEach(function (font) {
      var all = byFont[font];
      if (all.length < 9 || all.length < 0.6 * inkByFont[font]) return;
      if (font === body && Object.keys(inkByFont).length > 1) return;
      // chart rows hold several glyphs; a key glyph stands alone on its line
      var rowsAt = {};
      all.forEach(function (t) { var k = Math.round(t.y + t.h * 0.35); rowsAt[k] = (rowsAt[k] || 0) + 1; });
      var its = all.filter(function (t) {
        var k = Math.round(t.y + t.h * 0.35);
        return (rowsAt[k] || 0) + (rowsAt[k - 1] || 0) + (rowsAt[k + 1] || 0) >= 3;
      });
      if (its.length < 9) return;
      var widths = its.map(function (t) { return t.w; });
      var wm = median(widths);
      var narrow = its.filter(function (t) { return t.w <= 1.4 * wm; });
      var ry = regularize(positions(its.map(function (t) { return { p: t.y + t.h * 0.35 }; })));
      var rx = regularize(positions(narrow.map(function (t) { return { p: t.x + t.w / 2 }; })));
      if (!ry || !rx || ry.pos.length < 3 || rx.pos.length < 3) return;
      var py = ry.pitch, px = rx.pitch;
      if (px < 2.5 || py < 2.5 || px / py > 2.6 || py / px > 2.6) return;
      // glyphs sit in the middle of their cells: centres -> boundaries
      var X = [rx.pos[0] - px / 2], Y = [ry.pos[0] - py / 2];
      rx.pos.forEach(function (x) { X.push(x + px / 2); });
      ry.pos.forEach(function (y) { Y.push(y + py / 2); });
      var nr = Y.length - 1, nc = X.length - 1;
      var grid = [], filled = 0, units = [];
      for (var r = 0; r < nr; r++) { grid.push([]); for (var c = 0; c < nc; c++) grid[r].push(null); }
      its.forEach(function (t) {
        var rr = slotIndex(Y, t.y + t.h * 0.35);
        if (rr < 0) return;
        var k = Math.max(1, Math.round(t.w / px));
        var c0 = slotIndex(X, k > 1 ? t.x + px / 2 : t.x + t.w / 2);
        if (c0 < 0) return;
        var c1 = Math.min(nc - 1, c0 + k - 1);
        for (var cc = c0; cc <= c1; cc++) { if (grid[rr][cc] == null) filled++; grid[rr][cc] = k > 1 ? { span: true } : t.str; }
        if (k > 1) units.push({ r: rr, c0: c0, c1: c1, glyph: t.str });
      });
      if (filled < 0.5 * nr * nc) return;
      for (var r2 = 0; r2 < nr; r2++) for (var c2 = 0; c2 < nc; c2++) {
        var v = grid[r2][c2];
        if (v && v.span) continue;
        units.push({ r: r2, c0: c2, c1: c2, glyph: v == null ? '' : v });
      }
      out.push({ font: font, X: X, Y: Y, px: px, py: py, units: units, nr: nr, nc: nc,
        bb: { x0: X[0], y0: Y[0], x1: X[X.length - 1], y1: Y[Y.length - 1] } });
    });
    return out;
  }

  function glyphLegend(g, lines, texts) {
    var entries = [];
    // meanings are read from the other fonts' lines; the key glyph sits to their left
    buildLines(texts.filter(function (t) { return t.font !== g.font; })).forEach(function (ln) {
      if (!/[a-z]/i.test(ln.text)) return;
      var glyph = null;
      texts.forEach(function (t) {
        if (t.font !== g.font || t.str.length !== 1) return;
        var cx = t.x + t.w / 2, cy = t.y + t.h * 0.35;
        if (cx >= g.bb.x0 && cx <= g.bb.x1 && cy >= g.bb.y0 && cy <= g.bb.y1) return;
        if (t.x + t.w <= ln.x0 + 0.5 && t.x + t.w >= ln.x0 - 3 * g.px && abs(cy - ln.cy) <= 0.6 * g.py) {
          if (!glyph || t.x > glyph.x) glyph = t;
        }
      });
      if (glyph) entries.push({ meaning: cleanMeaning(ln.text), glyph: glyph.str, w: Math.max(1, Math.round(glyph.w / g.px)), raw: ln.text });
    });
    return entries;
  }

  /* ================================================================== *
   * 13. Assembling charts
   * ================================================================== */

  function letterSym(i) {
    var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return i < 26 ? a.charAt(i) : a.charAt(Math.floor(i / 26) - 1) + a.charAt(i % 26);
  }

  function pickSide(s) {
    return { stitch: s.stitch, text: s.text, run: s.run || null, consumes: s.consumes, produces: s.produces };
  }

  /** Public key entry from a parsed meaning. */
  function legendEntry(sym, spec, w) {
    var e = {
      sym: sym, meaning: spec.meaning, stitch: spec.stitch, text: spec.text, kind: spec.kind,
      consumes: spec.consumes, produces: spec.produces, color: spec.color || null,
      w: spec.stitch === 'cable' ? (spec.w || w || null) : (w > 1 ? w : 1), count: 0
    };
    if (spec.run) e.run = spec.run;
    if (spec.suffix) e.suffix = spec.suffix;
    if (spec.cross) e.cross = spec.cross;
    if (spec.rs) e.rs = pickSide(spec.rs);
    if (spec.ws) e.ws = pickSide(spec.ws);
    return e;
  }

  /** Syms for the page's key entries: the glyph when the sample is one glyph, else A, B, C... */
  function legendSyms(entries) {
    var taken = {};
    entries.forEach(function (e) {
      var sym = null;
      if (e.desc && e.desc.items.length === 1 && e.desc.items[0].k === 't' && !e.desc.bg) sym = e.desc.items[0].s;
      if (sym != null && !taken[sym]) { taken[sym] = true; e.sym = sym; } else e.sym = null;
    });
    var n = 0;
    entries.forEach(function (e) {
      if (e.sym != null) return;
      while (taken[letterSym(n)]) n++;
      e.sym = letterSym(n);
      taken[e.sym] = true;
      n++;
    });
  }

  function finishChart(chart, units, nc, rowInfo) {
    var minR = Infinity, maxR = -Infinity;
    units.forEach(function (u) { if (u.r < minR) minR = u.r; if (u.r > maxR) maxR = u.r; });
    if (minR === Infinity) return null;
    var cells = [];
    for (var r = minR; r <= maxR; r++) {
      var row = [];
      for (var c = 0; c < nc; c++) row.push(null);
      cells.push(row);
    }
    var spans = [];
    units.forEach(function (u) {
      for (var k = u.c0; k <= u.c1; k++) cells[u.r - minR][k] = u.sym;
      if (u.c1 > u.c0) spans.push({ r: u.r - minR, c0: u.c0, c1: u.c1, sym: u.sym });
    });
    var minC = Infinity, maxC = -Infinity;
    cells.forEach(function (row) { row.forEach(function (s, c) { if (s != null) { if (c < minC) minC = c; if (c > maxC) maxC = c; } }); });
    cells = cells.map(function (row) { return row.slice(minC, maxC + 1); });
    spans.forEach(function (s) { s.c0 -= minC; s.c1 -= minC; });
    chart.cols = maxC - minC + 1;
    chart.rows = cells.length;
    chart.cells = cells;
    chart.spans = spans;
    var start = rowInfo.start + rowInfo.step * minR;
    chart.startRow = start;
    chart.rowStep = rowInfo.step;
    chart.rowNos = cells.map(function (row, i) { return start + i * rowInfo.step; });
    chart.rowNumbersGuessed = !!rowInfo.guessed;
    chart.labelSide = rowInfo.sides;
    chart._shift = { r: minR, c: minC };
    return chart;
  }

  function shiftMark(m, shift, rows, cols) {
    if (m.c0 == null) return m;
    var o = copy(m);
    o.c0 = Math.max(0, m.c0 - shift.c);
    o.c1 = Math.min(cols - 1, m.c1 - shift.c);
    o.r0 = Math.max(0, m.r0 - shift.r);
    o.r1 = Math.min(rows - 1, m.r1 - shift.r);
    if (m.byRow) {
      o.byRow = {};
      Object.keys(m.byRow).forEach(function (r) {
        var rr = +r - shift.r;
        if (rr >= 0 && rr < rows) o.byRow[rr] = { c0: Math.max(0, m.byRow[r].c0 - shift.c), c1: Math.min(cols - 1, m.byRow[r].c1 - shift.c) };
      });
    }
    return o;
  }

  function counts(chart) {
    var n = {};
    chart.cells.forEach(function (row) { row.forEach(function (s) { if (s != null) n[s] = (n[s] || 0) + 1; }); });
    // a cable counts once, not once per cell it covers
    (chart.spans || []).forEach(function (s) { n[s.sym] -= (s.c1 - s.c0); });
    return n;
  }

  function finishRepeats(chart, marks) {
    // a red box and a "6 st repeat" caption over the same columns are one repeat
    chart.repeats = marks.filter(function (m, i) {
      if (m.kind !== 'repeat' || m.c0 == null) return false;
      for (var j = 0; j < i; j++) {
        var o = marks[j];
        if (o.kind === 'repeat' && o.c0 === m.c0 && o.c1 === m.c1 && o.r0 === m.r0 && o.r1 === m.r1 && !o.only === !m.only) return false;
      }
      return true;
    });
    chart.marks = marks.filter(function (m) { return !(m.kind === 'repeat' && m.c0 != null); });
    var rb = chart.repeats[0] || null;
    chart.repeatBox = rb ? { c0: rb.c0, c1: rb.c1, r0: rb.r0, r1: rb.r1, label: rb.label || null, only: !!rb.only } : null;
    if (rb && rb.byRow) chart.repeatBox.byRow = rb.byRow;
  }

  function vectorCharts(data, prims, lines, texts, opts) {
    var charts = [];
    var grids = vectorGrids(prims);
    if (!grids.length) return { charts: charts, grids: grids };
    var pitch = median(grids.map(function (g) { return g.py; }));
    var entries = findLegend(lines, prims, texts, grids, pitch);
    var own = entries.filter(function (e) { return !e.mark; }).length;
    if (!own && opts.legend && opts.legend.length) {
      // a key handed in from another page (scan) where this page has none
      entries = opts.legend.filter(function (e) { return e._desc; }).map(function (e) {
        return { meaning: e.meaning, desc: e._desc, w: e.w, borrowed: true };
      }).concat(entries);
    }
    legendSyms(entries);
    var skip = {};
    entries.forEach(function (e) { if (e.raw) skip[e.raw] = true; });
    var pageText = lines.map(function (l) { return l.text; }).join('\n');
    var repeatWord = /\brepeat\b|\brep\b/i.test(pageText);

    grids.forEach(function (g) {
      var rc = readCells(g, prims, texts);
      if (!rc.units.length) return;
      var unknown = assignSyms(rc.units, entries);
      rc.units.forEach(function (u) { u.sym = u.entry.sym; });
      var rowInfo = readRowLabels(g, rc.units, rc.nr, texts);
      var chart = {
        name: findTitle(g, lines, skip), page: opts.page || null, source: 'vector', image: false,
        readRS: 'rtl', bbox: { x0: round1(g.bb.x0), y0: round1(g.bb.y0), x1: round1(g.bb.x1), y1: round1(g.bb.y1) },
        pitch: { x: round1(g.px), y: round1(g.py) }
      };
      if (!finishChart(chart, rc.units, rc.nc, rowInfo)) return;
      var marks = readMarks(g, rc.marks, entries, rc.nr, repeatWord).concat(readBrackets(g, lines, prims, rc.nc));
      marks = marks.map(function (m) { return shiftMark(m, chart._shift, chart.rows, chart.cols); });
      var n = counts(chart);
      var legend = [];
      entries.forEach(function (e) {
        var spec = parseMeaning(e.meaning, e.w);
        var usedAsMark = e.mark && marks.some(function (m) { return m.label === e.meaning; });
        if (!n[e.sym] && !usedAsMark) return;
        var le = legendEntry(e.sym, spec, e.w);
        le.count = n[e.sym] || 0;
        if (e.mark) le.markColor = hex(e.color);
        if (e.desc && !e.mark) le._desc = e.desc;
        if (e.borrowed) le.borrowed = true;
        legend.push(le);
      });
      unknown.forEach(function (u) {
        if (!n[u.sym]) return;
        legend.push({ sym: u.sym, meaning: null, stitch: null, text: null, kind: 'unknown', consumes: null, produces: null, color: null, w: u.w, count: n[u.sym], _desc: u.desc });
      });
      chart.legend = legend;
      chart.noStitch = null;
      legend.forEach(function (e) { if (e.kind === 'nostitch' && chart.noStitch == null) chart.noStitch = e.sym; });
      chart.unknown = legend.filter(function (e) { return e.kind === 'unknown'; }).map(function (e) {
        var at = null;
        chart.cells.some(function (row, r) { return row.some(function (s, c) { if (s === e.sym) { at = { r: r, c: c }; return true; } return false; }); });
        return { sym: e.sym, count: e.count, at: at };
      });
      finishRepeats(chart, marks);
      delete chart._shift;
      charts.push(chart);
    });
    return { charts: charts, grids: grids };
  }

  function glyphCharts(prims, lines, texts, opts) {
    var charts = [];
    glyphGrids(texts).forEach(function (g) {
      var legend = [], bySym = {}, skip = {};
      glyphLegend(g, lines, texts).forEach(function (e) {
        skip[e.raw] = true;
        if (bySym[e.glyph]) return;
        var le = legendEntry(e.glyph, parseMeaning(e.meaning, e.w), e.w);
        bySym[e.glyph] = le;
        legend.push(le);
      });
      g.units.forEach(function (u) {
        u.sym = u.glyph;
        if (!bySym[u.sym]) {
          bySym[u.sym] = { sym: u.sym, meaning: null, stitch: null, text: null, kind: u.sym === '' ? 'blank' : 'unknown', consumes: null, produces: null, color: null, w: 1, count: 0 };
          legend.push(bySym[u.sym]);
        }
      });
      var rowInfo = readRowLabels(g, g.units, g.nr, texts.filter(function (t) { return t.font !== g.font; }));
      var chart = { name: findTitle(g, lines.filter(function (l) { return !l.items.some(function (it) { return it.font === g.font; }); }), skip), page: opts.page || null, source: 'glyph', image: false, readRS: 'rtl',
        bbox: { x0: round1(g.bb.x0), y0: round1(g.bb.y0), x1: round1(g.bb.x1), y1: round1(g.bb.y1) }, pitch: { x: round1(g.px), y: round1(g.py) } };
      if (!finishChart(chart, g.units, g.nc, rowInfo)) return;
      var n = counts(chart);
      chart.legend = legend.filter(function (e) { return n[e.sym]; }).map(function (e) { e.count = n[e.sym]; return e; });
      chart.noStitch = null;
      chart.legend.forEach(function (e) { if (e.kind === 'nostitch' && chart.noStitch == null) chart.noStitch = e.sym; });
      chart.unknown = chart.legend.filter(function (e) { return e.kind === 'unknown' || e.kind === 'blank'; }).map(function (e) { return { sym: e.sym, count: e.count, at: null }; });
      var marks = readBrackets(g, lines, prims, chart.cols).map(function (m) { return shiftMark(m, chart._shift, chart.rows, chart.cols); });
      finishRepeats(chart, marks);
      delete chart._shift;
      charts.push(chart);
    });
    return charts;
  }

  /**
   * The synchronous core: page data -> charts.
   * data = { texts:[{str,x,y,w,h,font}], shapes:[walkOps shapes], images:[{bb, chartLike}] }
   * opts = { page, legend } (legend: key entries borrowed from another page)
   */
  function analyse(data, opts) {
    opts = opts || {};
    var texts = (data.texts || []).filter(function (t) { return !t.q; });
    var prims = primitives(data.shapes || []);
    var lines = buildLines(texts);
    var v = vectorCharts(data, prims, lines, texts, opts);
    var charts = v.charts;
    if (!v.grids.length) charts = charts.concat(glyphCharts(prims, lines, texts, opts));

    // Raster charts: a picture that looks like a chart, on a page that talks about charts.
    var pageText = lines.map(function (l) { return l.text; }).join('\n');
    var mentions = [];
    pageText.replace(/\b[Cc]hart\s+[A-Z0-9]{1,2}\b|\b[A-Z][a-z]+ [Cc]hart\b/g, function (m) {
      if (/^(Follow|Using|Use|See|Work|Working|Repeat|Rep|Continue|Cont|From|The|This|Each|Read|Reading|Of|In|On) /.test(m)) return m;
      m = m.replace(/^c/, 'C');
      if (mentions.indexOf(m) < 0) mentions.push(m);
      return m;
    });
    (data.images || []).forEach(function (im) {
      if (bw(im.bb) < 90 || bh(im.bb) < 60) return;
      if (charts.some(function (c) { return c.bbox && boxesTouch(c.bbox, im.bb, 0); })) return;
      if (im.chartLike === false) return;
      var title = null;
      lines.forEach(function (ln) {
        var d = ln.y - im.bb.y1;
        if (d >= -2 && d <= 30 && ln.x0 < im.bb.x1 && ln.x1 > im.bb.x0 && /\bchart\b/i.test(ln.text) && ln.text.length < 60) title = ln.text;
      });
      if (!title && !(im.chartLike === true && /\bchart/i.test(pageText))) return;
      charts.push({ name: title, page: opts.page || null, source: 'image', image: true, cells: null, cols: null, rows: null,
        spans: [], legend: [], noStitch: null, readRS: 'rtl', startRow: null, rowStep: null, rowNos: null, labelSide: {},
        repeatBox: null, repeats: [], marks: [], unknown: [],
        bbox: { x0: round1(im.bb.x0), y0: round1(im.bb.y0), x1: round1(im.bb.x1), y1: round1(im.bb.y1) },
        mentions: mentions.slice() });
    });
    return charts;
  }

  /**
   * The synchronous core: page data -> charts.
   * data = { texts:[{str,x,y,w,h,q,font}], shapes:[walkOps shapes], images:[{bb, chartLike}] }
   * opts = { page, legend } (legend: key entries borrowed from another page)
   * A chart printed sideways (its numbers and caption turned a quarter) is read
   * in the frame where its text is upright; chart.turned says by how much.
   */
  function fromPageData(data, opts) {
    opts = opts || {};
    var charts = analyse(data, opts);
    var turns = {};
    (data.texts || []).forEach(function (t) { if (t.q) turns[t.q] = (turns[t.q] || 0) + 1; });
    Object.keys(turns).forEach(function (k) {
      var q = +k;
      if (turns[k] < 4) return;
      var more = analyse(turnData(data, q), opts).filter(function (c) { return c.source !== 'image' && !c.rowNumbersGuessed; });
      if (!more.length) return;
      more.forEach(function (c) {
        c.turned = q;
        c.pageBox = bboxOf([turnPt([c.bbox.x0, c.bbox.y0], (4 - q) % 4), turnPt([c.bbox.x1, c.bbox.y1], (4 - q) % 4)]);
      });
      charts = charts.filter(function (c) {
        return !(c.source !== 'image' && c.rowNumbersGuessed && more.some(function (m) { return boxesTouch(m.pageBox, c.bbox, 1); }));
      }).concat(more);
    });
    return charts;
  }

  /* ================================================================== *
   * 14. Handle entry points
   * ================================================================== */

  /**
   * A drawn chart whose cells cannot be trusted keeps everything the page says
   * in words (name, rows, row numbers, width, key meanings, repeat boxes) and
   * drops its cells: { cells: null, drawn: true, unread: why }.
   * opts.cells === false does that for every chart.
   */
  function settle(charts, opts) {
    opts = opts || {};
    charts.forEach(function (c) {
      if (c.source !== 'vector' && c.source !== 'glyph') return;
      var total = 0, unknown = 0;
      (c.cells || []).forEach(function (row) { row.forEach(function (s) { if (s != null) total++; }); });
      (c.unknown || []).forEach(function (u) { unknown += u.count; });
      var known = (c.legend || []).some(function (e) { return e.kind !== 'unknown' && e.kind !== 'blank' && e.kind !== 'repeat' && e.kind !== 'setup' && e.kind !== 'marker'; });
      var why = null;
      if (opts.cells === false) why = 'not asked';
      else if (!known) why = 'no key';
      else if (total && unknown > 0.25 * total) why = 'symbols not in the key';
      c.drawn = c.source === 'vector';
      if (!why) return;
      c.unread = why;
      c.cells = null;
      c.spans = [];
      c.unknown = [];
      c.legend = (c.legend || []).filter(function (e) { return e.kind !== 'unknown' && e.kind !== 'blank'; });
    });
    return charts;
  }

  function fromHandle(handle, pageNo, opts) {
    var settled = !(opts && opts._raw);
    return readHandle(handle, pageNo, opts).then(function (charts) { return settled ? settle(charts, opts) : charts; });
  }

  function readHandle(handle, pageNo, opts) {
    opts = opts || {};
    if (!handle || !handle.doc || typeof handle.doc.getPage !== 'function') return Promise.reject(new Error('KnitChart needs a PdfText.open() handle.'));
    var n = parseInt(pageNo, 10);
    var total = handle.numPages || handle.doc.numPages || 0;
    if (!isFinite(n) || n < 1 || n > total) return Promise.resolve([]);
    return handle.doc.getPage(n).then(function (page) {
      return readPage(page, opts).then(function (data) {
        try { if (typeof page.cleanup === 'function') page.cleanup(); } catch (e) { /* ignore */ }
        return fromPageData(data, { page: n, legend: opts.legend });
      });
    });
  }

  function isCancelled(sig) { return !!(sig && (sig.cancelled || sig.aborted)); }

  function hasOwnKey(chart) {
    return (chart.legend || []).some(function (e) { return e._desc && e.kind !== 'unknown' && !e.borrowed; });
  }

  /** Every page (or opts.pages); a chart with no key of its own borrows the nearest page's key. */
  function scan(handle, opts) {
    opts = opts || {};
    var total = (handle && (handle.numPages || (handle.doc && handle.doc.numPages))) || 0;
    var pages = (opts.pages || []).slice();
    if (!pages.length) for (var i = 1; i <= Math.min(total, opts.maxPages || 400); i++) pages.push(i);
    var results = [];
    var chain = Promise.resolve();
    pages.forEach(function (p) {
      chain = chain.then(function () {
        if (isCancelled(opts.signal)) { var e = new Error('Cancelled'); e.name = 'AbortError'; throw e; }
        return readHandle(handle, p, {}).then(function (charts) { results.push({ page: p, charts: charts }); });
      });
    });
    return chain.then(function () {
      var donors = results.filter(function (r) { return r.charts.some(hasOwnKey); });
      var again = Promise.resolve();
      results.forEach(function (r) {
        var needy = r.charts.some(function (c) { return c.source === 'vector' && !hasOwnKey(c) && c.unknown.length; });
        if (!needy) return;
        var donor = null, best = Infinity;
        donors.forEach(function (d) { var dist = abs(d.page - r.page); if (dist > 0 && dist <= 3 && dist < best) { best = dist; donor = d; } });
        if (!donor) return;
        var legend = [];
        donor.charts.forEach(function (c) { (c.legend || []).forEach(function (e) { if (e._desc && e.kind !== 'unknown' && !e.borrowed) legend.push(e); }); });
        again = again.then(function () {
          return readHandle(handle, r.page, { legend: legend }).then(function (charts) {
            charts.forEach(function (c) { if (c.legend.some(function (e) { return e.borrowed; })) c.legendFromPage = donor.page; });
            r.charts = charts;
          });
        });
      });
      return again.then(function () {
        results.forEach(function (r) { settle(r.charts, opts); });
        return results;
      });
    });
  }

  /* ================================================================== *
   * 15. Writing a row out
   * ================================================================== */

  function entryOf(chart, sym) {
    var l = chart.legend || [];
    for (var i = 0; i < l.length; i++) if (l[i].sym === sym) return l[i];
    return null;
  }

  function rowNumbers(chart) {
    return chart && chart.rowNos ? chart.rowNos.slice() : [];
  }

  function bandOf(chart, rowNo) {
    if (!chart || !chart.cells || chart.startRow == null) return -1;
    var d = rowNo - chart.startRow;
    if (d < 0 || d % chart.rowStep) return -1;
    var r = d / chart.rowStep;
    return r < chart.rows ? r : -1;
  }

  /** 'rs' | 'ws' when the caller left the side out: from where the number is printed. */
  function inferSide(chart, rowNo) {
    var ls = chart.labelSide || {};
    if (ls[rowNo]) return ls[rowNo] === 'left' ? 'ws' : 'rs';
    var rightPar = null, leftPar = null;
    Object.keys(ls).forEach(function (n) {
      if (ls[n] === 'right') rightPar = (+n) % 2;
      if (ls[n] === 'left') leftPar = (+n) % 2;
    });
    if (chart.rowStep === 2 && rightPar != null && leftPar == null) return 'rs';
    if (rightPar != null && rightPar === rowNo % 2) return 'rs';
    if (leftPar != null && leftPar === rowNo % 2) return 'ws';
    return rowNo % 2 ? 'rs' : 'ws';
  }

  function tokenFor(entry, side) {
    if (!entry || entry.kind === 'unknown' || entry.kind === 'blank') return { unknown: true, text: '[?]', consumes: null, produces: null };
    if (entry.kind === 'nostitch') return { skip: true, text: '', consumes: 0, produces: 0 };
    var spec = entry;
    if (side === 'ws' && entry.ws) spec = entry.ws;
    else if (entry.rs) spec = entry.rs;
    if (entry.kind !== 'stitch' || (!spec.text && !spec.run)) {
      return { unknown: true, text: '[' + (entry.meaning || '?') + ']', consumes: null, produces: null };
    }
    return {
      stitch: spec.stitch, run: spec.run || null, text: spec.text, suffix: entry.suffix || '',
      color: entry.color || null, consumes: spec.consumes, produces: spec.produces
    };
  }

  /**
   * The row's glyph units in knitting order:
   * [{sym, c0, c1, stitch, text, run, color, consumes, produces, skip, unknown}]
   */
  function rowCells(chart, rowNo, side) {
    var r = bandOf(chart, rowNo);
    if (r < 0) return null;
    if (side === undefined) side = inferSide(chart, rowNo);
    var row = chart.cells[r];
    var spanAt = {};
    (chart.spans || []).forEach(function (s) { if (s.r === r) for (var k = s.c0; k <= s.c1; k++) spanAt[k] = s; });
    var units = [];
    for (var c = 0; c < row.length; c++) {
      if (row[c] == null) continue;
      var s = spanAt[c];
      if (s) { if (c === s.c0) units.push({ sym: s.sym, c0: s.c0, c1: s.c1 }); continue; }
      units.push({ sym: row[c], c0: c, c1: c });
    }
    if (side !== 'ws') units.reverse();
    return units.map(function (u) {
      var t = tokenFor(entryOf(chart, u.sym), side);
      t.c0 = u.c0; t.c1 = u.c1; t.sym = u.sym;
      return t;
    });
  }

  function runText(base, n, suffix) {
    if (base === 'sl') return 'sl ' + n + (suffix || '');
    if (base === 'ktbl') return 'k' + n + ' tbl';
    if (base === 'ptbl') return 'p' + n + ' tbl';
    return base + n + (suffix || '');
  }

  /** k, k, k -> "k3"; ssk, ssk -> "ssk twice"; yo stays "yo, yo". */
  function compress(tokens) {
    var out = [];
    tokens.forEach(function (t) {
      if (t.skip) return;
      var last = out[out.length - 1];
      if (last && t.run && last.run === t.run && last.color === t.color && last.suffix === (t.suffix || '')) { last.n++; return; }
      if (last && !t.run && !last.run && !t.unknown && !last.unknown && last.text === t.text && last.color === t.color && t.stitch !== 'yo') { last.times++; return; }
      out.push({ run: t.run, text: t.text, color: t.color, suffix: t.suffix || '', n: 1, times: 1, unknown: !!t.unknown });
    });
    return out.map(function (o) {
      var s = o.run ? runText(o.run, o.n, o.suffix) : o.text + (o.times === 2 ? ' twice' : o.times > 2 ? ' ' + o.times + ' times' : '');
      if (o.color) s += ' ' + o.color;
      return s;
    });
  }

  function sum(tokens, key) {
    var t = 0;
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].skip) continue;
      if (tokens[i][key] == null) return null;
      t += tokens[i][key];
    }
    return t;
  }

  function sameKey(a, b) { return a.sym === b.sym && a.c1 - a.c0 === b.c1 - b.c0; }

  /**
   * Fold the repeat box: pre, *unit; rep from * to last N sts, post. Copies of
   * the unit drawn outside the box (a chart that shows two or three repeats)
   * fold into the repeat, which leaves the instruction unchanged.
   */
  function fold(units, rep) {
    var n = units.length, idx = [];
    units.forEach(function (u, i) { if (u.c0 >= rep.c0 && u.c1 <= rep.c1) idx.push(i); });
    if (!idx.length) return null;
    var s = idx[0], e = idx[idx.length - 1];
    var L = e - s + 1;
    var U = L;
    for (var p = 1; p < L; p++) {
      if (L % p) continue;
      var ok = true;
      for (var k = p; k < L && ok; k++) if (!sameKey(units[s + k], units[s + k % p])) ok = false;
      if (ok) { U = p; break; }
    }
    function matchAt(at, base) {
      if (at < 0 || at + U > n) return false;
      for (var k = 0; k < U; k++) if (!sameKey(units[at + k], units[base + k])) return false;
      return true;
    }
    // Every phase of the unit is tried: the widest cover wins, then the
    // shortest wording ("k1, *k3tog, ..., k3" rather than "*k1, k3tog, ..., k2").
    var best = null;
    for (var ph = 0; ph < U; ph++) {
      var base = s + ph;
      if (base + U > n) break;
      var a = base, b = base + U;
      while (matchAt(a - U, base)) a -= U;
      while (matchAt(b, base)) b += U;
      var cover = b - a;
      var words = compress(units.slice(0, a)).length + compress(units.slice(base, base + U)).length + compress(units.slice(b)).length;
      if (!best || cover > best.cover || (cover === best.cover && words < best.words)) best = { a: a, b: b, base: base, cover: cover, words: words };
      // the box's own phase covering the whole row is how the chart reads
      if (ph === 0 && a === 0 && b === n) break;
    }
    if (!best) return null;
    return { pre: units.slice(0, best.a), body: units.slice(best.base, best.base + U), post: units.slice(best.b), times: best.cover / U };
  }

  function repeatFor(chart, r, opts) {
    var list = chart.repeats && chart.repeats.length ? chart.repeats : (chart.repeatBox ? [chart.repeatBox] : []);
    if (opts.repeat === false) return null;
    if (typeof opts.repeat === 'number') list = list[opts.repeat] ? [list[opts.repeat]] : [];
    var rb = list[0];
    if (!rb) return null;
    if (r < (rb.r0 || 0) || r > (rb.r1 == null ? Infinity : rb.r1)) return null;
    var cols = rb.byRow ? rb.byRow[r] : { c0: rb.c0, c1: rb.c1 };
    if (!cols) return null;
    return { c0: cols.c0, c1: cols.c1, only: !!rb.only };
  }

  /**
   * The row written out, or null when it is not on the chart or a symbol in it
   * is not in the key (opts.partial writes "[?]" for those instead).
   * opts.repeat: false = ignore repeat boxes; n = use chart.repeats[n].
   */
  function rowText(chart, rowNo, side, opts) {
    opts = opts || {};
    if (!chart || !chart.cells) return null;
    var round = side === null;
    var toks = rowCells(chart, rowNo, side);
    if (!toks) return null;
    if (!opts.partial && toks.some(function (t) { return t.unknown; })) return null;
    var rep = repeatFor(chart, bandOf(chart, rowNo), opts);
    if (rep && rep.only) {
      // "for sizes worked over 60 sts": only the boxed stitches, as drawn
      var boxed = toks.filter(function (t) { return t.c0 >= rep.c0 && t.c1 <= rep.c1; });
      if (!boxed.length) return null;
      return '*' + compress(boxed).join(', ') + '; rep from * ' + (round ? 'around' : 'to end');
    }
    var f = rep ? fold(toks, rep) : null;
    // A box of one plain stitch adds nothing: "k22", not "*k1; rep from *".
    if (f && f.body.length === 1 && rep && !rep.only) f = null;
    if (f && f.body.some(function (t) { return !t.skip; })) {
      var body = compress(f.body).join(', ');
      var pre = compress(f.pre), post = compress(f.post);
      if (rep.only || (!pre.length && !post.length)) return '*' + body + '; rep from * ' + (round ? 'around' : 'to end');
      var out = (pre.length ? pre.join(', ') + ', ' : '') + '*' + body + '; rep from *';
      if (post.length) {
        var left = sum(f.post, 'consumes');
        out += left != null ? ' to last ' + (left === 1 ? 'st' : left + ' sts') + ', ' + post.join(', ') : ', end ' + post.join(', ');
      } else out += round ? ' around' : ' to end';
      return out;
    }
    return compress(toks).join(', ');
  }

  function rowInfo(chart, rowNo, side) {
    var toks = rowCells(chart, rowNo, side);
    if (!toks) return null;
    return {
      text: rowText(chart, rowNo, side),
      consumes: sum(toks, 'consumes'),
      produces: sum(toks, 'produces'),
      unknown: toks.filter(function (t) { return t.unknown; }).length
    };
  }

  function normName(s) {
    return String(s || '').toLowerCase().replace(/[,"”(].*$/, '').replace(/\bchart\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function find(charts, name) {
    var want = normName(name);
    if (!charts || !charts.length || !want) return null;
    var hit = null;
    charts.forEach(function (c) { if (!hit && normName(c.name) === want) hit = c; });
    if (hit) return hit;
    charts.forEach(function (c) {
      var n = normName(c.name);
      if (!hit && n && (n.indexOf(want + ' ') === 0 || want.indexOf(n + ' ') === 0)) hit = c;
    });
    return hit;
  }

  var api = {
    version: VERSION,
    fromHandle: fromHandle,
    scan: scan,
    fromPageData: fromPageData,
    settle: settle,
    readPage: readPage,
    rowCells: rowCells,
    rowText: rowText,
    rowInfo: rowInfo,
    rowNumbers: rowNumbers,
    find: find,
    parseMeaning: parseMeaning,
    /* exposed for tests */
    _walkOps: walkOps,
    _buildLines: buildLines,
    _regularize: regularize,
    _describe: describe,
    _descDistance: descDistance,
    _countSequence: countSequence,
    _pixelsLookLikeChart: pixelsLookLikeChart,
    _fold: fold,
    _pageKey: function (data) {
      var texts = (data.texts || []).filter(function (t) { return !t.q; }), prims = primitives(data.shapes || []), lines = buildLines(texts);
      var grids = vectorGrids(prims);
      if (!grids.length) return [];
      var entries = findLegend(lines, prims, texts, grids, median(grids.map(function (g) { return g.py; })));
      legendSyms(entries);
      return entries;
    },
    _grids: function (data) { return vectorGrids(primitives(data.shapes || [])); },
    _OPS: OPS_FALLBACK
  };
  if (typeof window !== 'undefined') window.KnitChart = api;
})();
