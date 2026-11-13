// js/sew-figures.js
// window.SewFigures - the pictures a sewing booklet already holds, found and cut out:
//   1. geometry helpers
//   2. reading a page's structure (PdfText.layout when it exists, else pdf.js directly)
//   3. step -> figure linking (P1 / S4)
//   4. crops into BlobStore (p:<id>:fig:*)
//   5. fabric swatches (P12 / S1)
//   6. tape-up map (P5)
//   7. the step's picture behind the Step-done label (S4)
// The pure parts (sections 1, 3, 5, 6's tapeMap) take plain objects and are unit-tested in
// test/sew-visual.test.html on synthetic layouts. Coordinates: page units, origin top-left,
// y down (docs/wave-k/api/pdftext.md); everything stored is normalised 0..1.
// Contract: docs/wave-k/api/sew-visual.md.
'use strict';

(function () {

  // =====================================================================
  // 1. Geometry helpers
  // =====================================================================

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  function box(x0, y0, x1, y1) {
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }
  function bw(b) { return b.x1 - b.x0; }
  function bh(b) { return b.y1 - b.y0; }
  function area(b) { return b ? Math.max(0, bw(b)) * Math.max(0, bh(b)) : 0; }
  function union(a, b) {
    if (!a) return b ? box(b.x0, b.y0, b.x1, b.y1) : null;
    if (!b) return box(a.x0, a.y0, a.x1, a.y1);
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  }
  function inter(a, b) {
    if (!a || !b) return null;
    var r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
    return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
  }
  function overlap1(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }
  /** Gap between two boxes (0 when they touch or overlap). */
  function gap(a, b) {
    var dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
    var dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
    return Math.sqrt(dx * dx + dy * dy);
  }
  function pad(b, p, w, h) {
    return {
      x0: Math.max(0, b.x0 - p), y0: Math.max(0, b.y0 - p),
      x1: Math.min(w, b.x1 + p), y1: Math.min(h, b.y1 + p)
    };
  }
  function norm(b, w, h) {
    if (!b || !(w > 0) || !(h > 0)) return null;
    var r = function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000; };
    return { x0: r(b.x0 / w), y0: r(b.y0 / h), x1: r(b.x1 / w), y1: r(b.y1 / h) };
  }
  function centre(b) { return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; }
  function within(p, b, slack) {
    slack = slack || 0;
    return p.x >= b.x0 - slack && p.x <= b.x1 + slack && p.y >= b.y0 - slack && p.y <= b.y1 + slack;
  }
  /** Accept {x0,y0,x1,y1} or [x0,y0,x1,y1]. */
  function toBox(b) {
    if (!b) return null;
    if (isArr(b) && b.length >= 4) return box(+b[0], +b[1], +b[2], +b[3]);
    if (typeof b.x0 === 'number') return box(b.x0, b.y0, b.x1, b.y1);
    return null;
  }

  /** Merge boxes whose gap is at most `tol` (single-link clustering). */
  function cluster(items, tol) {
    var groups = items.map(function (it) { return { box: toBox(it.box), members: [it] }; });
    var merged = true;
    while (merged) {
      merged = false;
      for (var i = 0; i < groups.length && !merged; i++) {
        for (var j = i + 1; j < groups.length; j++) {
          if (gap(groups[i].box, groups[j].box) <= tol) {
            groups[i].box = union(groups[i].box, groups[j].box);
            groups[i].members = groups[i].members.concat(groups[j].members);
            groups.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
    }
    return groups;
  }

  function fold(s) {
    return str(s).toLowerCase()
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  // =====================================================================
  // 2. Reading a page's structure
  // =====================================================================

  function mulM(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  function apM(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function hex2(v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? '0' + s : s; }
  function rgbHex(r, g, b) { return '#' + hex2(r) + hex2(g) + hex2(b); }
  function polyBox(poly) {
    var b = null;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      b = b ? { x0: Math.min(b.x0, p[0]), y0: Math.min(b.y0, p[1]), x1: Math.max(b.x1, p[0]), y1: Math.max(b.y1, p[1]) }
        : { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
    }
    return b;
  }

  /** Sutherland–Hodgman: a polygon cut to an axis-aligned box. */
  function clipPolyToBox(poly, b) {
    var out = poly;
    var edges = [
      function (p) { return p[0] >= b.x0; }, function (p) { return p[0] <= b.x1; },
      function (p) { return p[1] >= b.y0; }, function (p) { return p[1] <= b.y1; }
    ];
    var cuts = [
      function (a, c) { var t = (b.x0 - a[0]) / (c[0] - a[0]); return [b.x0, a[1] + t * (c[1] - a[1])]; },
      function (a, c) { var t = (b.x1 - a[0]) / (c[0] - a[0]); return [b.x1, a[1] + t * (c[1] - a[1])]; },
      function (a, c) { var t = (b.y0 - a[1]) / (c[1] - a[1]); return [a[0] + t * (c[0] - a[0]), b.y0]; },
      function (a, c) { var t = (b.y1 - a[1]) / (c[1] - a[1]); return [a[0] + t * (c[0] - a[0]), b.y1]; }
    ];
    for (var e = 0; e < 4 && out.length; e++) {
      var inp = out, res = [];
      for (var i = 0; i < inp.length; i++) {
        var cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
        var ci = edges[e](cur), pi = edges[e](prev);
        if (ci) { if (!pi) res.push(cuts[e](prev, cur)); res.push(cur); }
        else if (pi) res.push(cuts[e](prev, cur));
      }
      out = res;
    }
    return out;
  }

  /**
   * Walk a pdf.js 3.x operator list.
   * @param ol {fnArray, argsArray}; OPS pdfjsLib.OPS; vt the viewport transform (scale 1).
   * @returns {images:[{box, id, clipPoly}], paths:[{box, fill, stroke, poly|null, rects}],
   *           shapes:[Shape] (only when wantShapes)}
   * A path's polygon is kept only for wantShapes (the quilt reader); curves are flattened.
   */
  function readOps(ol, OPS, vt, wantShapes) {
    var fns = (ol && ol.fnArray) || [], args = (ol && ol.argsArray) || [];
    var gs = { ctm: vt.slice(), fill: '#000000', stroke: '#000000', clip: null, clipPoly: null, ca: 1, group: 0 };
    var stack = [];
    var images = [], paths = [], shapes = [], outlines = [];
    var cur = null;   // the path being built: {polys:[[pt]], box, rects}
    var copy = function (g) { var o = {}; for (var k in g) o[k] = g[k]; return o; };
    var MAX_SHAPES = 6000;

    function buildPath(a) {
      var ops = a[0] || [], co = a[1] || [], m = gs.ctm;
      var polys = [], poly = null, ci = 0, rects = 0, last = [0, 0], start = [0, 0];
      var pt = function (x, y) { var q = apM(m, x, y); if (poly) poly.push(q); last = [x, y]; };
      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        if (op === OPS.moveTo) {
          poly = []; polys.push(poly);
          pt(co[ci], co[ci + 1]); start = [co[ci], co[ci + 1]]; ci += 2;
        } else if (op === OPS.lineTo) {
          if (!poly) { poly = []; polys.push(poly); }
          pt(co[ci], co[ci + 1]); ci += 2;
        } else if (op === OPS.curveTo) {
          if (!poly) { poly = []; polys.push(poly); }
          var x0 = last[0], y0 = last[1];
          for (var t = 1; t <= 4; t++) {
            var u = t / 4, v = 1 - u;
            pt(v * v * v * x0 + 3 * v * v * u * co[ci] + 3 * v * u * u * co[ci + 2] + u * u * u * co[ci + 4],
              v * v * v * y0 + 3 * v * v * u * co[ci + 1] + 3 * v * u * u * co[ci + 3] + u * u * u * co[ci + 5]);
          }
          ci += 6;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          if (!poly) { poly = []; polys.push(poly); }
          pt(co[ci + 2], co[ci + 3]); ci += 4;
        } else if (op === OPS.closePath) {
          if (poly && poly.length) poly.push(apM(m, start[0], start[1]));
          last = start;
        } else if (op === OPS.rectangle) {
          var rx = co[ci], ry = co[ci + 1], rw = co[ci + 2], rh = co[ci + 3]; ci += 4;
          rects++;
          polys.push([apM(m, rx, ry), apM(m, rx + rw, ry), apM(m, rx + rw, ry + rh), apM(m, rx, ry + rh)]);
          poly = null;
        }
      }
      var b = null, all = [];
      for (var p = 0; p < polys.length; p++) {
        if (!polys[p].length) continue;
        var pb = polyBox(polys[p]);
        b = union(b, pb);
        all.push(polys[p]);
      }
      return b ? { box: b, polys: all, rects: rects } : null;
    }

    function paint(fill, stroke) {
      if (!cur) return;
      var b = cur.box;
      if (gs.clip) b = inter(b, gs.clip) || null;
      if (b) {
        paths.push({ box: b, fill: fill ? gs.fill : null, stroke: !!stroke, rects: cur.rects, n: cur.polys.length });
        if (wantShapes && shapes.length < MAX_SHAPES) {
          for (var i = 0; i < cur.polys.length; i++) {
            var pl = cur.polys[i];
            if (pl.length < 3) continue;
            // stroke-only paths are outlines (block cells, seam lines): kept apart from patches
            if (fill) shapes.push({ poly: pl, box: polyBox(pl), fill: gs.fill, image: null, stroke: !!stroke });
            else outlines.push({ poly: pl, box: polyBox(pl) });
          }
        }
      }
      cur = null;
    }

    function image(id) {
      var b0 = [apM(gs.ctm, 0, 0), apM(gs.ctm, 1, 0), apM(gs.ctm, 0, 1), apM(gs.ctm, 1, 1)];
      var b = polyBox(b0);
      var clipped = gs.clip ? inter(b, gs.clip) : b;
      if (!clipped || area(clipped) < 1) return;
      images.push({ box: clipped, id: id, full: b });
      if (wantShapes && shapes.length < MAX_SHAPES) {
        // the outline of the patch the print is clipped to, cut to every clip in force
        // (a clip of several paths, or none: the visible rectangle of the picture)
        var cp = gs.clipPoly ? clipPolyToBox(gs.clipPoly, clipped)
          : [[clipped.x0, clipped.y0], [clipped.x1, clipped.y0], [clipped.x1, clipped.y1], [clipped.x0, clipped.y1]];
        if (cp.length >= 3) shapes.push({ poly: cp, box: polyBox(cp), fill: null, image: id, stroke: false });
      }
    }

    for (var i = 0; i < fns.length; i++) {
      var fn = fns[i], a = args[i] || [];
      switch (fn) {
        case OPS.save: stack.push(copy(gs)); break;
        case OPS.restore: if (stack.length) gs = stack.pop(); break;
        case OPS.transform: gs.ctm = mulM(gs.ctm, a); break;
        case OPS.paintFormXObjectBegin:
          stack.push(copy(gs));
          if (a[0] && a[0].length === 6) gs.ctm = mulM(gs.ctm, a[0]);
          if (a[1] && a[1].length === 4) {
            var fb = polyBox([apM(gs.ctm, a[1][0], a[1][1]), apM(gs.ctm, a[1][2], a[1][3])]);
            gs.clip = gs.clip ? (inter(gs.clip, fb) || { x0: 0, y0: 0, x1: 0, y1: 0 }) : fb;
          }
          break;
        case OPS.paintFormXObjectEnd: if (stack.length) gs = stack.pop(); break;
        case OPS.beginGroup: stack.push(copy(gs)); gs.group++; break;
        case OPS.endGroup: if (stack.length) gs = stack.pop(); break;
        case OPS.setFillRGBColor: gs.fill = rgbHex(a[0], a[1], a[2]); break;
        case OPS.setStrokeRGBColor: gs.stroke = rgbHex(a[0], a[1], a[2]); break;
        case OPS.setFillColorN: gs.fill = null; break;    // a pattern or shading fill
        case OPS.setGState:
          (a[0] || []).forEach(function (kv) { if (kv && kv[0] === 'ca') gs.ca = kv[1]; });
          break;
        case OPS.constructPath: cur = buildPath(a); break;
        case OPS.clip:
        case OPS.eoClip:
          if (cur) {
            gs.clip = gs.clip ? (inter(gs.clip, cur.box) || { x0: 0, y0: 0, x1: 0, y1: 0 }) : cur.box;
            gs.clipPoly = cur.polys.length === 1 ? cur.polys[0] : null;
            cur.clipped = true;
          }
          break;
        case OPS.endPath: cur = null; break;
        case OPS.fill:
        case OPS.eoFill: paint(true, false); break;
        case OPS.stroke:
        case OPS.closeStroke: paint(false, true); break;
        case OPS.fillStroke:
        case OPS.eoFillStroke:
        case OPS.closeFillStroke:
        case OPS.closeEOFillStroke: paint(true, true); break;
        case OPS.paintImageXObject:
        case OPS.paintJpegXObject:
          image(typeof a[0] === 'string' ? a[0] : 'img' + i); break;
        case OPS.paintInlineImageXObject:
        case OPS.paintImageMaskXObject:
          image('inline' + i); break;
        default: break;
      }
    }
    return { images: images, paths: paths, shapes: shapes, outlines: outlines };
  }

  /**
   * Text items of pdf.js getTextContent -> lines in reading order (y down).
   * Items on one baseline join when the gap is under 1.2 font heights, so two
   * columns at the same height stay two lines.
   */
  function textLines(items, vt) {
    var runs = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string' || !it.str.replace(/\s/g, '')) continue;
      var m = mulM(vt, it.transform || [1, 0, 0, 1, 0, 0]);
      var hgt = Math.sqrt(m[2] * m[2] + m[3] * m[3]) || num(it.height, 10);
      var sx = Math.sqrt(vt[0] * vt[0] + vt[1] * vt[1]) || 1;
      var x = m[4], y = m[5], w = num(it.width, 0) * sx;
      runs.push({ text: it.str, box: box(x, y - hgt * 0.8, x + w, y + hgt * 0.2), h: hgt, y: y });
    }
    runs.sort(function (a, b) { return Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.4 ? a.y - b.y : a.box.x0 - b.box.x0; });
    var lines = [];
    var open = [];
    runs.forEach(function (r) {
      var hit = null;
      for (var k = open.length - 1; k >= 0; k--) {
        var L = open[k];
        if (Math.abs(L.y - r.y) <= Math.min(L.h, r.h) * 0.4 && r.box.x0 - L.box.x1 < r.h * 1.2 && r.box.x0 > L.box.x0 - r.h) { hit = L; break; }
      }
      if (hit) {
        var sep = r.box.x0 - hit.box.x1 > r.h * 0.15 && !/\s$/.test(hit.text) && !/^\s/.test(r.text) ? ' ' : '';
        hit.text += sep + r.text;
        hit.box = union(hit.box, r.box);
      } else {
        var L2 = { text: r.text, box: r.box, h: r.h, y: r.y };
        lines.push(L2);
        open.push(L2);
        if (open.length > 12) open.shift();
      }
    });
    lines.forEach(function (l) { l.text = l.text.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); });
    return orderLines(lines);
  }

  /** Reading order: columns found from x-overlap, then top to bottom in each. */
  function orderLines(lines) {
    if (!lines.length) return lines;
    var cols = [];
    lines.slice().sort(function (a, b) { return a.box.x0 - b.box.x0; }).forEach(function (l) {
      for (var c = 0; c < cols.length; c++) {
        if (overlap1(l.box.x0, l.box.x1, cols[c].x0, cols[c].x1) > Math.min(bw(l.box), cols[c].x1 - cols[c].x0) * 0.3) {
          cols[c].x0 = Math.min(cols[c].x0, l.box.x0); cols[c].x1 = Math.max(cols[c].x1, l.box.x1);
          cols[c].lines.push(l); return;
        }
      }
      cols.push({ x0: l.box.x0, x1: l.box.x1, lines: [l] });
    });
    // A full-width line (a heading over both columns) makes one band; keep
    // it simple: order by y, but within a y-band left column first.
    var out = lines.slice().sort(function (a, b) {
      var ov = overlap1(a.box.y0, a.box.y1, b.box.y0, b.box.y1);
      if (ov > 0) return a.box.x0 - b.box.x0;
      return a.box.y0 - b.box.y0;
    });
    out.forEach(function (l, i) { l.i = i; });
    return out;
  }

  /** Vector regions from paint boxes: drop page-sized backgrounds and long rules, then cluster. */
  function drawingRegions(paths, w, h) {
    var keep = [];
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i], b = p.box;
      if (!b) continue;
      if (bw(b) > w * 0.92 && bh(b) > h * 0.9) continue;          // background
      if (bw(b) < 0.5 && bh(b) < 0.5) continue;
      if ((bw(b) > w * 0.5 && bh(b) < 3) || (bh(b) > h * 0.5 && bw(b) < 3)) continue;  // rules
      if (p.fill && !p.stroke && p.rects && bw(b) * bh(b) > w * h * 0.25) continue;   // a tint panel
      keep.push(p);
    }
    if (keep.length > 4000) keep = keep.slice(0, 4000);
    var groups = cluster(keep, 6);
    var out = [];
    groups.forEach(function (g) {
      var fills = 0, strokes = 0;
      g.members.forEach(function (m) { if (m.fill) fills++; if (m.stroke) strokes++; });
      if (g.members.length < 2 && area(g.box) < 400) return;   // a lone dot or bullet
      out.push({ box: g.box, paths: g.members.length, fills: fills, strokes: strokes });
    });
    return out;
  }

  function abortErr() { var e = new Error('Stopped.'); e.name = 'AbortError'; return e; }
  function stopped(signal) { return !!(signal && (signal.cancelled || signal.aborted)); }

  /** One page straight from pdf.js (used until PdfText's handle.layout exists, and for shapes). */
  function readPageDirect(doc, n, wantShapes) {
    return doc.getPage(n).then(function (page) {
      var vp = page.getViewport({ scale: 1 });
      var vt = vp.transform;
      var OPS = window.pdfjsLib && window.pdfjsLib.OPS;
      return Promise.all([
        page.getTextContent(),
        OPS ? page.getOperatorList() : Promise.resolve(null)
      ]).then(function (res) {
        var lines = textLines(res[0].items || [], vt);
        var g = res[1] ? readOps(res[1], OPS, vt, wantShapes) : { images: [], paths: [], shapes: [] };
        var info = {
          page: n, width: vp.width, height: vp.height,
          lines: lines.map(function (l) { return { text: l.text, box: l.box, i: l.i, size: l.h }; }),
          images: g.images.map(function (im) { return { box: im.box, id: im.id }; }),
          drawings: drawingRegions(g.paths, vp.width, vp.height)
        };
        if (wantShapes) { info.shapes = g.shapes; info.outlines = g.outlines; }
        if (typeof page.cleanup === 'function') { try { page.cleanup(); } catch (e) { /* ignore */ } }
        return info;
      });
    });
  }

  /** PdfText's PageLayout -> PageInfo (boxes may be arrays or objects). */
  function fromLayout(L, n) {
    return {
      page: L.page || n, width: L.width, height: L.height,
      lines: (L.lines || []).map(function (l, i) { return { text: l.text, box: toBox(l.box), i: typeof l.i === 'number' ? l.i : i, size: l.size }; }),
      images: (L.images || []).map(function (im) { return { box: toBox(im.box), id: im.id }; }),
      drawings: (L.drawings || []).map(function (d) { return { box: toBox(d.box), paths: d.paths, fills: d.fills, strokes: d.strokes, kind: d.kind }; }),
      captions: L.captions || []
    };
  }

  /**
   * SewFigures.readPages(handle, pageNumbers, opts) -> Promise<{[n]: PageInfo}>
   * opts = { signal, onProgress(done, total), shapes: false }
   */
  function readPages(handle, pageNumbers, opts) {
    opts = opts || {};
    var out = {};
    if (!handle) return Promise.resolve(out);
    var list = [];
    (pageNumbers || []).forEach(function (n) { n = parseInt(n, 10); if (n >= 1 && list.indexOf(n) < 0) list.push(n); });
    list.sort(function (a, b) { return a - b; });
    var useLayout = typeof handle.layout === 'function' && !opts.shapes;
    var doc = handle.doc;
    var k = 0;
    function next() {
      if (stopped(opts.signal)) return Promise.reject(abortErr());
      if (k >= list.length) return Promise.resolve(out);
      var n = list[k++];
      var p = useLayout
        ? handle.layout(n, { signal: opts.signal }).then(function (L) { return fromLayout(L, n); })
        : (doc ? readPageDirect(doc, n, !!opts.shapes) : Promise.resolve(null));
      return p.then(function (info) {
        if (info) out[n] = info;
      }, function (err) {
        if (err && err.name === 'AbortError') throw err;
      }).then(function () {
        if (typeof opts.onProgress === 'function') { try { opts.onProgress(k, list.length); } catch (e) { /* ignore */ } }
        return next();
      });
    }
    return next();
  }

  // =====================================================================
  // 3. Step -> figure linking
  // =====================================================================

  // (?![a-z]): 'Illustrations below' is not 'Illustration S'
  var REF_RE = /\b(fig(?:ure)?s?\.?|diagram|illustration|illus\.?)(?![a-z])\s*([0-9]{1,3}[a-z]?|[A-Z][0-9]{0,2}[a-z]?)\b/gi;
  var CAPTION_RE = /^\(?\s*(fig(?:ure)?\.?|diagram|illustration|illus\.?)(?![a-z])\s*([0-9]{1,3}[a-z]?|[A-Z][0-9]{0,2}[a-z]?)\s*\)?(?:[.:\-–—]|\s|$)/i;
  var STEP_MARK_RE = /^\s*(?:step\s*)?\d{1,3}\s*[.):]?\s+(?=\S)/i;

  /** 'Figure 3' / 'Fig. 3' / 'DIAGRAM B 1' -> 'figure 3' / 'diagram b1' (the join key). */
  function refKey(kind, label) {
    var k = /^d/i.test(kind) ? 'diagram' : (/^i/i.test(kind) ? 'illustration' : 'figure');
    return k + ' ' + str(label).toLowerCase().replace(/\s+/g, '');
  }
  function refsIn(text) {
    var out = [], seen = {}, m;
    var t = str(text).replace(/\b(diagram|fig(?:ure)?\.?)\s+([A-Z])\s+(\d)\b/gi, '$1 $2$3');
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(t))) {
      // 'Figure' + a capital only counts when it is a single letter or letter+digits ('Diagram B1')
      if (/^[a-z]/.test(m[2])) continue;   // a letter label is a capital: "diagram of" is not Diagram O
      var k = refKey(m[1], m[2]);
      if (!seen[k]) { seen[k] = 1; out.push({ key: k, text: m[0].replace(/\s+/g, ' ') }); }
    }
    REF_RE.lastIndex = 0;
    return out;
  }
  function captionKey(text) {
    var t = str(text).replace(/\b(diagram|fig(?:ure)?\.?)\s+([A-Z])\s+(\d)\b/gi, '$1 $2$3');
    var m = CAPTION_RE.exec(t.replace(/^\s+/, ''));
    if (!m || /^[a-z]/.test(m[2])) return null;
    // A caption is short: 'Figure 3', 'Fig. 3 – the pocket', not a sentence that starts with it.
    if (t.length > 60) return null;
    return refKey(m[1], m[2]);
  }

  /** Words of a line, the step marker dropped, folded. */
  function lineKey(text) { return fold(str(text).replace(STEP_MARK_RE, '')); }

  /**
   * Which step does each line of a page belong to? Order-independent: a line
   * belongs to the step whose text contains it (folded), ambiguous lines take
   * the owner of the nearest owned line above them in the same column.
   * @returns {number[]} owner per line (a position in `cands`, or -1)
   */
  function assignLines(lines, cands) {
    var keys = cands.map(function (c) { return ' ' + fold(c.text) + ' '; });
    var bags = cands.map(function (c) {
      var o = {}; fold(c.text).split(' ').forEach(function (w) { if (w.length > 2) o[w] = 1; }); return o;
    });
    var owner = [], amb = [];
    for (var i = 0; i < lines.length; i++) {
      var lk = lineKey(lines[i].text);
      owner[i] = -1; amb[i] = null;
      if (lk.length < 8 || lk.split(' ').length < 2) continue;
      var hits = [];
      for (var c = 0; c < cands.length; c++) {
        if (keys[c].indexOf(' ' + lk + ' ') >= 0 || keys[c].indexOf(' ' + lk) >= 0) hits.push(c);
      }
      if (!hits.length) {
        // Word-bag fallback: extraction repairs (ligatures, hyphens) differ a little.
        var words = lk.split(' ').filter(function (w) { return w.length > 2; });
        if (words.length >= 4) {
          var best = -1, bestN = 0, second = 0;
          for (var c2 = 0; c2 < cands.length; c2++) {
            var n = 0;
            for (var w = 0; w < words.length; w++) if (bags[c2][words[w]]) n++;
            if (n > bestN) { second = bestN; bestN = n; best = c2; } else if (n > second) second = n;
          }
          if (best >= 0 && bestN >= words.length * 0.8 && second < bestN * 0.7) hits.push(best);
        }
      }
      if (hits.length === 1) owner[i] = hits[0];
      else if (hits.length > 1) amb[i] = hits;
    }
    // Ambiguous lines: the owner of the nearest owned line above, same column.
    for (var j = 0; j < lines.length; j++) {
      if (!amb[j]) continue;
      var bj = lines[j].box, pick = -1, dist = Infinity;
      for (var k = 0; k < lines.length; k++) {
        if (owner[k] < 0 || amb[j].indexOf(owner[k]) < 0) continue;
        var bk = lines[k].box;
        if (overlap1(bj.x0, bj.x1, bk.x0, bk.x1) <= 0) continue;
        var d = bj.y0 - bk.y0;
        if (d > 0 && d < dist) { dist = d; pick = owner[k]; }
      }
      owner[j] = pick;
    }
    return owner;
  }

  /** Text columns: x-intervals of the narrower lines, merged by overlap. */
  function columnsOf(lines, w) {
    var cols = [];
    lines.forEach(function (l) {
      var b = l.box;
      if (bw(b) > w * 0.7 || bw(b) < 4) return;
      for (var c = 0; c < cols.length; c++) {
        var C = cols[c];
        if (overlap1(b.x0, b.x1, C.x0, C.x1) > Math.min(bw(b), C.x1 - C.x0) * 0.25) {
          C.x0 = Math.min(C.x0, b.x0); C.x1 = Math.max(C.x1, b.x1); C.n++; return;
        }
      }
      cols.push({ x0: b.x0, x1: b.x1, n: 1 });
    });
    // merge columns that grew into each other
    var merged = true;
    while (merged) {
      merged = false;
      for (var i = 0; i < cols.length && !merged; i++) {
        for (var j = i + 1; j < cols.length; j++) {
          if (overlap1(cols[i].x0, cols[i].x1, cols[j].x0, cols[j].x1) > 0) {
            cols[i].x0 = Math.min(cols[i].x0, cols[j].x0); cols[i].x1 = Math.max(cols[i].x1, cols[j].x1);
            cols[i].n += cols[j].n; cols.splice(j, 1); merged = true; break;
          }
        }
      }
    }
    return cols.filter(function (c) { return c.n >= 2; }).sort(function (a, b) { return a.x0 - b.x0; });
  }

  /** Graphics regions worth showing: images and vector drawings, no backgrounds, no specks. */
  function graphicRegions(pg) {
    var W = pg.width, H = pg.height, out = [];
    function add(b, kind) {
      b = toBox(b);
      if (!b) return;
      b = inter(b, box(0, 0, W, H));
      if (!b) return;
      var a = area(b);
      if (a > W * H * 0.8) return;                         // the page itself (a scan, a background)
      if (a < W * H * 0.004 && Math.min(bw(b), bh(b)) < 30) return;   // icons, bullets, logos
      if (Math.min(bw(b), bh(b)) < 12) return;            // rules and bars
      // A frame round a column or a tint panel behind text holds lines of text: it is
      // layout, not a figure (and, clustered, it would swallow every drawing inside it).
      var held = 0;
      (pg.lines || []).forEach(function (l) {
        var lb = toBox(l.box);
        if (lb && str(l.text).length > 30 && within(centre(lb), b)) held++;   // prose, not a part label
      });
      if (held >= 3) return;
      out.push({ box: b, kind: kind });
    }
    (pg.images || []).forEach(function (im) { add(im.box, 'image'); });
    (pg.drawings || []).forEach(function (d) {
      if (d.kind === 'rule' || d.kind === 'box') { if (d.kind === 'rule') return; }
      add(d.box, 'drawing');
    });
    // Touching pieces are one figure (an image with arrows drawn over it).
    return cluster(out, 4).map(function (g) {
      var kinds = {};
      g.members.forEach(function (m) { kinds[m.kind] = 1; });
      return { box: g.box, kind: kinds.image && kinds.drawing ? 'mixed' : (kinds.image ? 'image' : 'drawing') };
    });
  }

  function pageMargin(pg) { return pg.height * 0.06; }

  /**
   * SewFigures.link(steps, pages, opts) -> [FigureLink]
   */
  function link(steps, pages, opts) {
    opts = opts || {};
    var minConf = num(opts.minConfidence, 0.6);
    steps = isArr(steps) ? steps : [];
    pages = pages || {};
    var res = steps.map(function (s, i) {
      return { index: i, stepId: (s && s.id) || null, page: (s && typeof s.page === 'number') ? s.page : null,
        mode: 'none', rect: null, text: null, confidence: 0, reason: 'no page known for this step', ref: null };
    });

    // Steps by page; a step whose text runs over the page break is a candidate on the next page too.
    var byPage = {};
    steps.forEach(function (s, i) {
      if (!s || typeof s.page !== 'number') return;
      (byPage[s.page] = byPage[s.page] || []).push(i);
    });
    var pageNums = Object.keys(byPage).map(Number).sort(function (a, b) { return a - b; });

    // Captions on every page we have: key -> [{page, box}]
    var capIndex = {};
    Object.keys(pages).forEach(function (pn) {
      var pg = pages[pn];
      if (!pg || !pg.lines) return;
      var regs = graphicRegions(pg);
      pg.__regs = regs;
      pg.lines.forEach(function (l) {
        var k = captionKey(l.text);
        if (k) (capIndex[k] = capIndex[k] || []).push({ page: +pn, box: toBox(l.box), how: 'caption' });
      });
      // A bare number printed inside or right on a drawing ('3') names that figure.
      pg.lines.forEach(function (l) {
        var t = str(l.text).replace(/^\s+|\s+$/g, '');
        if (!/^[0-9]{1,2}[a-z]?$/.test(t)) return;
        var lb = toBox(l.box), c = centre(lb);
        for (var r = 0; r < regs.length; r++) {
          if (within(c, regs[r].box, 2)) {
            (capIndex['figure ' + t.toLowerCase()] = capIndex['figure ' + t.toLowerCase()] || []).push({ page: +pn, box: lb, how: 'number', reg: r });
            break;
          }
        }
      });
      // PdfText's own captions (when its layout API is in use) are the best evidence.
      (pg.captions || []).forEach(function (cp) {
        if (!cp || !cp.ref) return;
        var k = captionKey(cp.ref);
        if (!k) return;
        var tb = null;
        if (cp.target && cp.target.type === 'image' && pg.images && pg.images[cp.target.index]) tb = toBox(pg.images[cp.target.index].box);
        if (cp.target && cp.target.type === 'drawing' && pg.drawings && pg.drawings[cp.target.index]) tb = toBox(pg.drawings[cp.target.index].box);
        (capIndex[k] = capIndex[k] || []).unshift({ page: +pn, box: toBox(cp.box), how: 'pdftext', target: tb });
      });
    });

    /** The figure region a caption names: the target pdftext gave, else the nearest region. */
    function captionRegion(cap) {
      var pg = pages[cap.page];
      if (!pg) return null;
      if (cap.target) return { box: cap.target, page: cap.page };
      var regs = pg.__regs || [];
      if (cap.how === 'number' && regs[cap.reg]) return { box: regs[cap.reg].box, page: cap.page };
      var best = null, bd = Infinity;
      for (var r = 0; r < regs.length; r++) {
        var b = regs[r].box;
        var d = gap(b, cap.box);
        var xo = overlap1(b.x0, b.x1, cap.box.x0, cap.box.x1);
        if (xo <= 0 && d > 6) d += 30;          // not under / over the caption
        if (d < bd) { bd = d; best = b; }
      }
      return best && bd <= 36 ? { box: best, page: cap.page } : null;
    }

    pageNums.forEach(function (pn) {
      var pg = pages[pn];
      var idx = byPage[pn];
      if (!pg || !pg.lines || !(pg.width > 0)) {
        idx.forEach(function (i) { res[i].mode = 'none'; res[i].reason = 'the page was not read'; });
        return;
      }
      var W = pg.width, H = pg.height;
      // Candidates on this page: its own steps, plus the step carried over from the page before.
      var cands = idx.slice();
      var prevIdx = -1;
      for (var q = idx[0] - 1; q >= 0; q--) { if (steps[q] && typeof steps[q].page === 'number') { prevIdx = q; break; } }
      if (prevIdx >= 0 && steps[prevIdx].page === pn - 1) cands.unshift(prevIdx);
      var lines = pg.lines.map(function (l) { return { text: l.text, box: toBox(l.box) }; }).filter(function (l) { return l.box; });
      var owner = assignLines(lines, cands.map(function (i) { return steps[i]; }));
      var cols = columnsOf(lines, W);
      var regs = pg.__regs || graphicRegions(pg);

      // Each step's text box on this page, per column.
      var textBox = {}, colRuns = [];
      lines.forEach(function (l, li) {
        if (owner[li] < 0) return;
        var si = cands[owner[li]];
        textBox[si] = union(textBox[si], l.box);
      });
      // Territories: in each column, a run of one step's lines down to the next other step's line.
      cols.forEach(function (C) {
        var inCol = [];
        lines.forEach(function (l, li) {
          if (overlap1(l.box.x0, l.box.x1, C.x0, C.x1) > bw(l.box) * 0.5) inCol.push(li);
        });
        inCol.sort(function (a, b) { return lines[a].box.y0 - lines[b].box.y0; });
        var run = null;
        inCol.forEach(function (li) {
          if (owner[li] < 0) return;
          var si = cands[owner[li]];
          if (run && run.step === si) { run.last = lines[li].box.y1; return; }
          if (run) { run.y1 = lines[li].box.y0; colRuns.push(run); }
          run = { step: si, col: C, y0: lines[li].box.y0, last: lines[li].box.y1, y1: null };
        });
        if (run) { run.y1 = H - pageMargin(pg); colRuns.push(run); }
      });

      // Who owns each region?
      var owned = {};
      regs.forEach(function (g) {
        var b = g.box;
        // a tint panel or image behind text: it holds several lines of one step's text
        var inside = 0;
        lines.forEach(function (l, li) { if (owner[li] >= 0 && within(centre(l.box), b)) inside++; });
        if (inside >= 3) return;
        if (b.y1 < pageMargin(pg) || b.y0 > H - pageMargin(pg)) return;     // running heads, footers
        var score = {};
        colRuns.forEach(function (r) {
          var xo = overlap1(b.x0, b.x1, r.col.x0, r.col.x1) / bw(b);
          var yo = overlap1(b.y0, b.y1, r.y0, r.y1) / bh(b);
          var s = xo * yo;
          // Below the run's own text (the usual place) counts fully; above its first line it cannot be.
          if (s > (score[r.step] || 0)) score[r.step] = s;
        });
        // Beside: no text column at this height overlaps the drawing.
        var besideText = false;
        lines.forEach(function (l) {
          if (overlap1(b.x0, b.x1, l.box.x0, l.box.x1) > 2 && overlap1(b.y0, b.y1, l.box.y0, l.box.y1) > 1 && !within(centre(l.box), b)) besideText = true;
        });
        // a drawing that sits inside a text column is that column's, never "beside" another
        cols.forEach(function (C) { if (overlap1(b.x0, b.x1, C.x0, C.x1) > bw(b) * 0.5) besideText = true; });
        if (!besideText) {
          // level with a step's own lines in a column next to it (not its text on the whole
          // page: a step that runs over two columns spans the page height)
          colRuns.forEach(function (r) {
            var yo = overlap1(b.y0, b.y1, r.y0, r.last) / bh(b);
            var near = Math.max(0, Math.max(b.x0, r.col.x0) - Math.min(b.x1, r.col.x1)) < W * 0.25;
            var s2 = near ? yo * 0.9 : 0;
            if (s2 > (score[r.step] || 0)) score[r.step] = s2;
          });
        }
        var keys = Object.keys(score).sort(function (a, c) { return score[c] - score[a]; });
        if (!keys.length) return;
        var best = score[keys[0]], second = keys.length > 1 ? score[keys[1]] : 0;
        if (best < 0.5 || best - second < 0.3) return;      // two steps could own it: neither does
        var conf = Math.min(0.95, 0.55 + (best - second) * 0.4);
        var si = +keys[0];
        (owned[si] = owned[si] || []).push({ box: b, conf: conf, beside: !besideText, kind: g.kind });
      });

      function holdsOtherText(b, si) {
        for (var li = 0; li < lines.length; li++) {
          if (owner[li] >= 0 && cands[owner[li]] !== si && within(centre(lines[li].box), b)) return true;
        }
        return false;
      }
      /** Prose (25+ characters, anyone's) whose centre lies in b. */
      function proseIn(b) {
        var n = 0;
        for (var li = 0; li < lines.length; li++) {
          if (str(lines[li].text).length >= 25 && within(centre(lines[li].box), b)) n++;
        }
        return n;
      }
      /**
       * Drawings joined top to bottom while joining them takes in no line of prose:
       * a step with drawings between its paragraphs gives several figures, never one column
       * chunk of text and drawings (sundress p6, step 1).
       */
      function groupParts(boxes) {
        var bs = boxes.slice().sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });
        var groups = [];
        bs.forEach(function (b) {
          var g = groups.length ? groups[groups.length - 1] : null;
          var joined = g ? union(g, b) : null;
          if (g && proseIn(joined) <= proseIn(g) + proseIn(b)) groups[groups.length - 1] = joined;   // joining adds no prose
          else groups.push(b);
        });
        return groups;
      }

      // Numbered figures with their numbers printed inside the pictures (Samford's "(Figure 9)"
      // is part of the drawing): when the steps on this page name exactly as many figures as the
      // page has pictures, the k-th picture in reading order is the k-th figure named.
      // Every figure the page's steps name counts (a count that leaves one out shifts them all,
      // and a shifted figure is a wrong one); a caption on the page turns this rule off.
      // A '(Figure 1)' line that is part of a step's own text is a reference, not a caption.
      // (owned, and set right under or over another line of the same step: in the paragraph)
      var ownedSig = {};
      lines.forEach(function (l, li) {
        if (owner[li] < 0) return;
        var lh = Math.max(4, bh(l.box));
        var inFlow = lines.some(function (o, oi) {
          return oi !== li && owner[oi] === owner[li] && overlap1(o.box.x0, o.box.x1, l.box.x0, l.box.x1) > 0 &&
            Math.min(Math.abs(o.box.y0 - l.box.y1), Math.abs(l.box.y0 - o.box.y1)) < lh * 1.2;
        });
        if (inFlow) ownedSig[Math.round(l.box.x0) + ',' + Math.round(l.box.y0)] = 1;
      });
      var ownedCap = function (c) { return !!(c.box && ownedSig[Math.round(c.box.x0) + ',' + Math.round(c.box.y0)]); };
      var refOrder = [], refSeen = {}, captioned = false;
      idx.forEach(function (si) {
        refsIn(steps[si].text).forEach(function (rf) {
          if (!/^figure \d/.test(rf.key) || refSeen[rf.key]) return;
          refSeen[rf.key] = 1;
          refOrder.push(rf.key);
          if ((capIndex[rf.key] || []).some(function (c) { return (c.page === pn || c.page === pn + 1) && (c.how === 'pdftext' || (c.how === 'caption' && !(c.page === pn && ownedCap(c)))); })) captioned = true;
        });
      });
      if (captioned) refOrder = [];
      var byRef = {};
      var usable = regs.filter(function (g) { return !(g.box.y1 < pageMargin(pg) || g.box.y0 > H - pageMargin(pg)); });
      if (refOrder.length >= 2 && usable.length === refOrder.length) {
        var nums = refOrder.map(function (k) { return parseInt(k.replace(/\D+/g, ''), 10); });
        var ascending = nums.every(function (v, k) { return k === 0 || v === nums[k - 1] + 1; });
        if (ascending) {
          var ordered = usable.slice().sort(function (a, b) {
            var ov = overlap1(a.box.y0, a.box.y1, b.box.y0, b.box.y1);
            if (ov > Math.min(bh(a.box), bh(b.box)) * 0.5) return a.box.x0 - b.box.x0;
            return a.box.y0 - b.box.y0;
          });
          refOrder.forEach(function (k, n) { byRef[k] = ordered[n].box; });
        }
      }

      idx.forEach(function (si) {
        var r = res[si];
        var step = steps[si];
        var tb = textBox[si] || null;
        r.text = tb ? norm(tb, W, H) : null;
        var refs = refsIn(step.text);
        r.ref = refs.length ? refs[0].text.replace(/^\(|\)$/g, '') : null;

        // 1. Captions the step names.
        var capBoxes = [], capPage = null, capWhy = '';
        refs.forEach(function (rf) {
          var caps = capIndex[rf.key] || [];
          for (var c = 0; c < caps.length; c++) {
            var cap = caps[c];
            if (cap.page !== pn && cap.page !== pn + 1) continue;
            if (capPage !== null && cap.page !== capPage) continue;
            var cr = captionRegion(cap);
            if (!cr) continue;
            capPage = cap.page;
            capBoxes.push(union(cr.box, cap.how === 'caption' || cap.how === 'pdftext' ? cap.box : null));
            if (!capWhy) capWhy = (cap.how === 'number' ? 'number ' : 'caption ') + '"' + rf.text.replace(/^\(|\)$/g, '') + '"';
            break;
          }
        });
        if (capBoxes.length) {
          var cu = null;
          capBoxes.forEach(function (b) { cu = union(cu, b); });
          var capPg = pages[capPage];
          if (cu && !(capPage === pn && holdsOtherText(cu, si)) && area(cu) < capPg.width * capPg.height * 0.75) {
            r.mode = 'figure'; r.page = capPage;
            var cg = capPage === pn ? groupParts(capBoxes) : [cu];
            r.rect = norm(pad(cg[0], 6, capPg.width, capPg.height), capPg.width, capPg.height);
            if (cg.length > 1) r.parts = cg.map(function (g) { return norm(pad(g, 6, capPg.width, capPg.height), capPg.width, capPg.height); });
            r.confidence = capBoxes.length === refs.length ? 0.92 : 0.8;
            r.reason = capWhy + (capPage !== pn ? ' (figure on the next page)' : '');
            return;
          }
        }

        // 1b. Figures numbered in reading order (see byRef): the step's own figures, joined
        // while the joined box holds no other step's text.
        var mineRef = refs.filter(function (rf) { return byRef[rf.key]; });
        if (mineRef.length) {
          var ru = null, used = 0;
          mineRef.forEach(function (rf) {
            var next = union(ru, byRef[rf.key]);
            if (!holdsOtherText(next, si)) { ru = next; used++; }
          });
          if (ru) {
            r.mode = 'figure';
            var rg = groupParts(mineRef.map(function (rf) { return byRef[rf.key]; }));
            r.rect = norm(pad(rg[0], 6, W, H), W, H);
            r.confidence = 0.75;
            r.reason = 'figures ' + mineRef.map(function (rf) { return rf.key.replace('figure ', ''); }).join(', ') + ' by their order on the page' + (used < mineRef.length ? ' (' + used + ' of ' + mineRef.length + ')' : '');
            r.parts = mineRef.map(function (rf) { return norm(pad(byRef[rf.key], 6, W, H), W, H); });
            return;
          }
        }

        // 2. Drawings in the step's own space. Not on a page whose steps name numbered figures
        // that could be neither found by caption nor counted in order: there the pictures are
        // laid out by number, not beside their text (Samford p11), and a nearby picture is as
        // likely the step before's.
        var mine = owned[si] || [];
        if (refOrder.length && !Object.keys(byRef).length) {
          r.mode = 'page';
          r.confidence = 0;
          r.rect = tb ? norm(pad(tb, 12, W, H), W, H) : null;
          r.reason = 'the page\'s figures are numbered, and which is which could not be read';
          return;
        }
        if (mine.length) {
          var u = null, conf = 1, beside = false;
          mine.forEach(function (m) { u = union(u, m.box); conf = Math.min(conf, m.conf); if (m.beside) beside = true; });
          if (holdsOtherText(u, si)) {
            mine.sort(function (a, b) { return area(b.box) - area(a.box); });
            u = mine[0].box; conf = mine[0].conf * 0.9; beside = mine[0].beside;
            if (holdsOtherText(u, si)) u = null;
          }
          if (u && conf >= minConf) {
            // the step's drawings as figures of their own when its paragraphs run between them
            var inside = mine.filter(function (m) { return inter(m.box, u); }).map(function (m) { return m.box; });
            var groups = groupParts(inside.length ? inside : [u]);
            r.mode = 'figure';
            r.rect = norm(pad(groups[0], 6, W, H), W, H);
            if (groups.length > 1) r.parts = groups.map(function (g) { return norm(pad(g, 6, W, H), W, H); });
            r.confidence = Math.round(conf * 100) / 100;
            r.reason = (beside ? 'drawing beside the step' : 'drawing in the step\'s own space') +
              (groups.length > 1 ? ' (the first of ' + groups.length + ' figures)' : (mine.length > 1 ? ' (' + mine.length + ' parts)' : ''));
            return;
          }
        }

        // 3. The honest fallback: the page, framed around the step's text.
        r.mode = 'page';
        r.confidence = 0;
        if (tb) {
          var col = null;
          cols.forEach(function (C) { if (overlap1(tb.x0, tb.x1, C.x0, C.x1) > 0) col = col ? { x0: Math.min(col.x0, C.x0), x1: Math.max(col.x1, C.x1) } : { x0: C.x0, x1: C.x1 }; });
          var fr = box(col ? Math.min(col.x0, tb.x0) : tb.x0, tb.y0, col ? Math.max(col.x1, tb.x1) : tb.x1, tb.y1);
          r.rect = norm(pad(fr, 12, W, H), W, H);
          r.reason = mine.length ? 'a drawing near this step is not clearly its own' : 'no drawing near this step';
        } else {
          r.rect = null;
          r.reason = 'the step\'s text was not found on its page';
        }
      });
    });
    Object.keys(pages).forEach(function (pn) { if (pages[pn]) delete pages[pn].__regs; });
    res.forEach(function (r) {
      var pg = pages[r.page];
      if (r.rect && pg && pg.width > 0) {
        var hh = (r.rect.y1 - r.rect.y0) * pg.height;
        r.aspect = hh > 0 ? Math.round((r.rect.x1 - r.rect.x0) * pg.width / hh * 1000) / 1000 : null;
      }
    });
    return res;
  }

  // =====================================================================
  // 4. Crops into BlobStore
  // =====================================================================

  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function rectSig(r) {
    return [r.x0, r.y0, r.x1, r.y1].map(function (v) { return Math.round(v * 1000); }).join(',');
  }
  function cropKey(projectId, lk, kind) {
    if (!lk || !lk.rect || typeof lk.page !== 'number') return null;
    return 'p:' + projectId + ':' + (kind || 'fig') + ':' + lk.page + ':' + hashStr(rectSig(lk.rect) + '|' + (lk.mode || ''));
  }
  function blobs() {
    return window.BlobStore && typeof window.BlobStore.available === 'function' && window.BlobStore.available() ? window.BlobStore : null;
  }

  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve) {
      if (!canvas.toBlob) { resolve(null); return; }
      canvas.toBlob(function (b) { resolve(b || null); }, 'image/jpeg', quality);
    });
  }
  function release(canvas) { if (canvas) { canvas.width = 1; canvas.height = 1; } }

  /**
   * Draw `rect` (normalised) of PDF page `n` into a canvas `outW` px wide, straight from
   * pdf.js with a viewport offset, so only the crop's pixels are ever allocated.
   */
  function renderPdfRegion(handle, n, rect, outW, maxPixels, signal) {
    // Own pdf.js path first (exact width, 'print' intent so a hidden tab still draws);
    // PdfText's renderRegion when the handle does not expose its document.
    if (!handle.doc && typeof handle.renderRegion === 'function') {
      return handle.renderRegion(n, { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, norm: true },
        { maxSide: Math.max(outW, 64), signal: signal }).then(function (cv) {
        // scale to the asked width (renderRegion's maxSide bounds the long side)
        return cv;
      });
    }
    var doc = handle.doc;
    if (!doc) return Promise.reject(new Error('No PDF to draw from.'));
    return doc.getPage(n).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var rw = (rect.x1 - rect.x0) * base.width, rh = (rect.y1 - rect.y0) * base.height;
      if (!(rw > 0 && rh > 0)) throw new Error('Empty crop.');
      var s = outW / rw;
      if (rw * rh * s * s > maxPixels) s = Math.sqrt(maxPixels / (rw * rh));
      var vp = page.getViewport({ scale: s, offsetX: -rect.x0 * base.width * s, offsetY: -rect.y0 * base.height * s });
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(rw * s));
      cv.height = Math.max(1, Math.round(rh * s));
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      // 'print' never waits on requestAnimationFrame, so a hidden tab still draws.
      var task = page.render({ canvasContext: ctx, viewport: vp, intent: 'print' });
      var watch = null;
      var stop = new Promise(function (resolve, reject) {
        watch = setInterval(function () {
          if (!stopped(signal)) return;
          clearInterval(watch); watch = null;
          try { task.cancel(); } catch (e) { /* done */ }
          reject(abortErr());
        }, 50);
      });
      return Promise.race([task.promise, stop]).then(function () {
        if (watch) clearInterval(watch);
        try { page.cleanup(); } catch (e) { /* ignore */ }
        return cv;
      }, function (err) {
        if (watch) clearInterval(watch);
        release(cv);
        throw stopped(signal) ? abortErr() : err;
      });
    });
  }

  /** Crop a stored page JPEG (BlobStore) to rect, outW px wide. */
  function cropStoredPage(blobKey, rect, outW) {
    var B = blobs();
    if (!B) return Promise.reject(new Error('No picture store.'));
    return B.get(blobKey).then(function (blob) {
      if (!blob) throw new Error('The page picture is gone.');
      return loadImage(blob).then(function (img) {
        var iw = img.width, ih = img.height;
        var sx = rect.x0 * iw, sy = rect.y0 * ih, sw = (rect.x1 - rect.x0) * iw, sh = (rect.y1 - rect.y0) * ih;
        var w = Math.max(1, Math.round(Math.min(outW, sw * 2))), h = Math.max(1, Math.round(w * sh / sw));
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img.src, sx, sy, sw, sh, 0, 0, w, h);
        img.close();
        return cv;
      });
    });
  }

  function loadImage(blob) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob).then(function (bm) {
        return { src: bm, width: bm.width, height: bm.height, close: function () { if (bm.close) bm.close(); } };
      });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var im = new Image();
      im.onload = function () { resolve({ src: im, width: im.naturalWidth, height: im.naturalHeight, close: function () { URL.revokeObjectURL(url); } }); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read the picture.')); };
      im.src = url;
    });
  }

  function regionCanvas(source, lk, outW, maxPixels, signal) {
    if (source && source.handle) return renderPdfRegion(source.handle, lk.page, lk.rect, outW, maxPixels, signal);
    if (source && source.pages) {
      var row = null;
      for (var i = 0; i < source.pages.length; i++) if (source.pages[i] && source.pages[i].n === lk.page) row = source.pages[i];
      if (!row) return Promise.reject(new Error('That page was not kept.'));
      return cropStoredPage(row.blobKey, lk.rect, outW);
    }
    return Promise.reject(new Error('Nothing to draw from.'));
  }

  /**
   * SewFigures.renderCrops(projectId, links, source, opts) -> Promise<[Crop|null]>
   */
  function renderCrops(projectId, links, source, opts) {
    opts = opts || {};
    var modes = opts.modes || ['figure'];
    var outW = num(opts.width, 750), maxPixels = num(opts.maxPixels, 1.2e6), quality = num(opts.quality, 0.82);
    var B = blobs();
    var result = (links || []).map(function () { return null; });
    var todo = [];
    (links || []).forEach(function (lk, i) {
      if (lk && lk.rect && typeof lk.page === 'number' && modes.indexOf(lk.mode) >= 0) todo.push(i);
    });
    var done = 0;
    var made = {};   // the same crop for two steps is cut once
    function step(k) {
      if (stopped(opts.signal)) return Promise.reject(abortErr());
      if (k >= todo.length) return Promise.resolve(result);
      var i = todo[k], lk = links[i];
      var key = cropKey(projectId, lk);
      var base = { index: i, blobKey: key, mode: lk.mode, aspect: lk.aspect || null, cached: false };
      var p;
      if (made[key]) p = Promise.resolve(made[key]);
      else {
        p = (B ? B.get(key) : Promise.resolve(null)).then(function (have) {
          if (have) { base.cached = true; return base; }
          return regionCanvas(source, lk, outW, maxPixels, opts.signal).then(function (cv) {
            base.w = cv.width; base.h = cv.height; base.aspect = cv.width / cv.height;
            return canvasToBlob(cv, quality).then(function (blob) {
              release(cv);
              if (!blob || !B) return blob ? (base.blob = blob, base) : null;
              return B.put(key, blob).then(function () { return base; });
            });
          });
        });
      }
      return p.then(function (c) {
        if (c) { made[key] = c; result[i] = c === base ? base : { index: i, blobKey: c.blobKey, mode: c.mode, aspect: c.aspect, w: c.w, h: c.h, cached: true }; }
      }, function (err) {
        if (err && err.name === 'AbortError') throw err;
        result[i] = null;
      }).then(function () {
        done++;
        if (typeof opts.onProgress === 'function') { try { opts.onProgress(done, todo.length); } catch (e) { /* ignore */ } }
        return step(k + 1);
      });
    }
    return step(0);
  }

  function deleteCrops(projectId) {
    var B = blobs();
    if (!B) return Promise.resolve();
    return Promise.all([B.deletePrefix('p:' + projectId + ':fig:'), B.deletePrefix('p:' + projectId + ':swatch:')]).then(function () {});
  }

  // =====================================================================
  // 5. Fabric swatches
  // =====================================================================

  // 'PWCG001.PANEL', 'OMH-33447', 'FUS-P-1208', 'DSE-700', 'PE-464', 'CSFSESS.NAVY'
  var CODE_RE = /\b([A-Z]{2,7})(?:-([A-Z]{1,3}))?[-.]?(\d{3,6})(?:\.([A-Z]{2,14}))?\b/gi;
  var LETTER_RE = /\((?:[Ff]abric\s+)?([A-Z]{1,2})\)|\b(?:[Ff]abric|FABRIC)\s+([A-Z]{1,2})\b/g;

  function codesIn(text) {
    var out = [], m, t = str(text);
    CODE_RE.lastIndex = 0;
    while ((m = CODE_RE.exec(t))) {
      // skip measures and years ('1208' alone never matches: a prefix is required)
      out.push({ text: m[0], prefix: m[1].toUpperCase(), mid: (m[2] || '').toUpperCase(), digits: m[3], colour: (m[4] || '').toUpperCase(), at: m.index, len: m[0].length });
    }
    CODE_RE.lastIndex = 0;
    return out;
  }
  function lettersIn(text) {
    var out = [], m, t = str(text);
    LETTER_RE.lastIndex = 0;
    while ((m = LETTER_RE.exec(t))) out.push({ letter: (m[1] || m[2]).toUpperCase(), at: m.index, len: m[0].length });
    LETTER_RE.lastIndex = 0;
    return out;
  }
  function editDist1(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 1) return 2;
    if (a.length === b.length) {
      var d = 0, sw = -1;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { d++; if (sw < 0) sw = i; }
      if (d === 1) return 1;
      // one transposition ('OHM' / 'OMH') counts as one slip
      if (d === 2 && a[sw] === b[sw + 1] && a[sw + 1] === b[sw]) return 1;
      return 2;
    }
    var s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
    for (var j = 0; j <= s.length; j++) if (l.slice(0, j) + l.slice(j + 1) === s) return 1;
    return 2;
  }
  /** 2 = the same code, 1 = the same code with a one-letter slip in the prefix, 0 = different. */
  function codeMatch(a, b) {
    if (!a || !b || a.digits !== b.digits) return 0;
    if (a.colour && b.colour && a.colour !== b.colour) return 0;
    if (a.prefix === b.prefix && a.mid === b.mid) return 2;
    return editDist1(a.prefix + a.mid, b.prefix + b.mid) <= 1 ? 1 : 0;
  }

  /** Label tokens on a page with an estimated box each (a line may hold several). */
  function labelTokens(lines) {
    var out = [];
    lines.forEach(function (l, li) {
      var b = toBox(l.box), t = str(l.text);
      if (!b || !t) return;
      var cw = bw(b) / Math.max(1, t.length);
      var at = function (i, n) { return box(b.x0 + i * cw, b.y0, b.x0 + (i + n) * cw, b.y1); };
      lettersIn(t).forEach(function (L) {
        // a letter label is a short thing: '(A)' alone or in a row of labels, not inside a sentence
        if (t.replace(/\((?:fabric\s+)?[A-Z]{1,2}\)/gi, '').replace(/\s+/g, '').length > 24 && !/^\s*fabric\s+[A-Z]{1,2}\b/i.test(t)) return;
        out.push({ kind: 'letter', letter: L.letter, box: at(L.at, L.len), line: t, li: li, lineBox: b });
      });
      codesIn(t).forEach(function (c) { out.push({ kind: 'code', code: c, box: at(c.at, c.len), line: t, li: li, lineBox: b }); });
    });
    return out;
  }

  function fabricKeys(row, mapLines) {
    var text = str(row && row.name) + ' ' + str(row && row.line);
    var letters = lettersIn(text).map(function (l) { return l.letter; });
    var m = /^\s*([A-Z])\s*[).:\-–]\s+/.exec(str(row && row.name));
    if (m) letters.push(m[1]);
    var codes = codesIn(text);
    // Catwalk: a page maps 'Fabric A' to its code on the same line.
    if (letters.length && !codes.length && mapLines) codes = mapLines[letters[0]] || [];
    return { letters: letters, codes: codes };
  }

  /**
   * SewFigures.swatches(fabric, pages, opts) -> [Swatch]
   */
  function swatches(fabric, pages, opts) {
    opts = opts || {};
    fabric = isArr(fabric) ? fabric : [];
    var res = fabric.map(function (f, i) {
      return { index: i, name: str(f && f.name), label: '', code: '', page: null, rect: null, clean: false, reason: 'no picture with this label' };
    });
    // Letter -> code lines ('Fabric A  OMH-33447 F8'), from every page.
    var mapLines = {};
    Object.keys(pages || {}).forEach(function (pn) {
      ((pages[pn] && pages[pn].lines) || []).forEach(function (l) {
        var L = lettersIn(l.text), C = codesIn(l.text);
        if (L.length === 1 && C.length === 1 && /fabric/i.test(l.text)) mapLines[L[0].letter] = C;
      });
    });
    var keys = fabric.map(function (f) { return fabricKeys(f, mapLines); });

    // Candidate swatch pictures with the label nearest them, per page.
    var found = [];   // {page, box, tok}
    Object.keys(pages || {}).forEach(function (pn) {
      var pg = pages[pn];
      if (!pg || !pg.lines) return;
      var toks = labelTokens(pg.lines);
      if (!toks.length) return;
      var pics = [], seenPic = {};
      var addPic = function (b) {
        b = toBox(b);
        if (!b) return;
        // a picture drawn twice (an image and its mask) is one picture
        var sig = [b.x0, b.y0, b.x1, b.y1].map(function (v) { return Math.round(v / 2); }).join(',');
        if (seenPic[sig]) return;
        seenPic[sig] = 1;
        pics.push(b);
      };
      (pg.images || []).forEach(function (im) { addPic(im.box); });
      (pg.drawings || []).forEach(function (d) { if (d.kind === 'swatch') addPic(d.box); });
      // flat-colour swatches (a solid's square), when the page was read with its shapes
      (pg.shapes || []).forEach(function (s) { if (s.fill && !s.image && s.poly && s.poly.length <= 6) addPic(s.box); });
      pics = pics.filter(function (b) {
        var s0 = Math.min(bw(b), bh(b)), s1 = Math.max(bw(b), bh(b));
        return !(s0 < 18 || s1 > 280 || s1 / s0 > 2.6);
      });
      var here = [], given = {};
      // A row of labels on one text line under a row of pictures ('(B)  (C)  (D)'): when the
      // counts agree they pair up left to right (a token's place inside a line is only estimated).
      var byLine = {};
      toks.forEach(function (t) { (byLine[t.li] = byLine[t.li] || []).push(t); });
      Object.keys(byLine).forEach(function (li) {
        var ts = byLine[li];
        if (ts.length < 2) return;
        var lb = ts[0].lineBox;
        var inX = function (b) { var cx = (b.x0 + b.x1) / 2; return cx >= lb.x0 - 30 && cx <= lb.x1 + 30; };
        // the pictures over the line first (labels sit under swatches), else those under it
        var row = pics.filter(function (b) { return inX(b) && lb.y0 >= b.y1 - 2 && lb.y0 - b.y1 <= 30; });
        if (row.length !== ts.length) row = pics.filter(function (b) { return inX(b) && b.y0 >= lb.y1 - 2 && b.y0 - lb.y1 <= 30; });
        if (row.length !== ts.length) return;
        row.sort(function (a, b) { return a.x0 - b.x0; });
        ts = ts.slice().sort(function (a, b) { return a.box.x0 - b.box.x0; });
        row.forEach(function (b, k) { here.push({ page: +pn, box: b, tok: ts[k], W: pg.width, H: pg.height }); given[pics.indexOf(b)] = 1; });
      });
      pics.forEach(function (b, pi) {
        if (given[pi]) return;
        var s0 = Math.min(bw(b), bh(b));
        var best = null, bd = Infinity;
        toks.forEach(function (t) {
          var c = centre(t.box);
          if (c.x < b.x0 - 4 || c.x > b.x1 + 4) return;            // under or over the picture
          var d = c.y > b.y1 ? c.y - b.y1 : (c.y < b.y0 ? (b.y0 - c.y) * 1.3 : 9999);
          if (d < bd) { bd = d; best = t; }
        });
        if (best && bd <= Math.max(30, s0 * 0.4)) here.push({ page: +pn, box: b, tok: best, W: pg.width, H: pg.height, below: centre(best.box).y > b.y1 });
      });
      // A label used under one picture is that picture's; the picture under it (a second row)
      // may not borrow it from above.
      here = here.filter(function (h) { return h.below !== false || !here.some(function (o) { return o !== h && o.tok === h.tok && o.below !== false; }); });
      // A page of swatches labels several of them; one labelled picture is a cover or a photo.
      if (here.length >= 3) found = found.concat(here);
    });
    // Two pictures under one label, or one picture under two labels, is not clean.
    var tokUse = {};
    found.forEach(function (f) {
      var k = f.page + ':' + (f.tok.kind === 'letter' ? 'L' + f.tok.letter : 'C' + f.tok.code.text.toUpperCase());
      f.tk = k; tokUse[k] = (tokUse[k] || 0) + 1;
    });

    var claimed = found.map(function () { return []; });
    keys.forEach(function (k, fi) {
      var hits = [];
      found.forEach(function (f, j) {
        var score = 0;
        if (f.tok.kind === 'letter' && k.letters.indexOf(f.tok.letter) >= 0) score = 2;
        if (f.tok.kind === 'code') {
          for (var c = 0; c < k.codes.length; c++) score = Math.max(score, codeMatch(k.codes[c], f.tok.code));
        }
        if (score) hits.push({ j: j, score: score });
      });
      if (!hits.length) return;
      hits.sort(function (a, b) { return b.score - a.score; });
      var top = hits.filter(function (h) { return h.score === hits[0].score; });
      var f = found[top[0].j];
      var r = res[fi];
      r.page = f.page;
      r.rect = norm(f.box, f.W, f.H);
      r.label = f.tok.kind === 'letter' ? f.tok.letter : '';
      r.code = f.tok.kind === 'code' ? f.tok.code.text : '';
      r.reason = (f.tok.kind === 'letter' ? 'labelled (' + f.tok.letter + ')' : 'labelled ' + f.tok.code.text) +
        (f.tok.box.y0 > f.box.y1 ? ' under the picture' : ' over the picture') + (top[0].score === 1 ? ' (code printed with a slip)' : '');
      r.clean = top.length === 1 && tokUse[f.tk] === 1;
      if (!r.clean) r.reason += top.length > 1 ? '; more than one picture carries this label' : '; the label sits under two pictures';
      claimed[top[0].j].push(fi);
    });
    claimed.forEach(function (list) {
      // two rows matched by the same label are the same fabric (Binding — Fabric A): both keep it
      if (list.length > 1) list.forEach(function (fi) { res[fi].reason += '; the same picture as row ' + (list[0] === fi ? list[1] + 1 : list[0] + 1); });
    });
    return res;
  }

  // Colour maths (sRGB -> CIELAB, D65), the same formulas js/xstitch-photo.js uses.
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function unlin(c) { c = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); }
  function toLab(r, g, b) {
    var R = lin(r), G = lin(g), B = lin(b);
    var x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function fromLab(L, a, b) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    var g = function (t) { return t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787; };
    var x = g(fx) * 0.95047, y = g(fy), z = g(fz) * 1.08883;
    var R = x * 3.2406 + y * -1.5372 + z * -0.4986, G = x * -0.9689 + y * 1.8758 + z * 0.0415, B = x * 0.0557 + y * -0.2040 + z * 1.0570;
    return [unlin(R), unlin(G), unlin(B)];
  }

  /**
   * SewFigures.colourOf(imageData) -> { colour, spread }: the mean colour of the middle 70%
   * in CIELAB (so a print's colours average as the eye sees them), and how varied it is.
   */
  function colourOf(img) {
    if (!img || !img.data || !(img.width > 0)) return { colour: null, spread: 0 };
    var w = img.width, h = img.height, d = img.data;
    var x0 = Math.floor(w * 0.15), x1 = Math.ceil(w * 0.85), y0 = Math.floor(h * 0.15), y1 = Math.ceil(h * 0.85);
    var step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 4096)));
    var labs = [], sL = 0, sa = 0, sb = 0;
    for (var y = y0; y < y1; y += step) {
      for (var x = x0; x < x1; x += step) {
        var i = (y * w + x) * 4;
        if (d[i + 3] < 128) continue;
        var lab = toLab(d[i], d[i + 1], d[i + 2]);
        labs.push(lab); sL += lab[0]; sa += lab[1]; sb += lab[2];
      }
    }
    if (!labs.length) return { colour: null, spread: 0 };
    var n = labs.length, mL = sL / n, ma = sa / n, mb = sb / n, de = 0;
    for (var k = 0; k < n; k++) {
      var dl = labs[k][0] - mL, da = labs[k][1] - ma, db = labs[k][2] - mb;
      de += Math.sqrt(dl * dl + da * da + db * db);
    }
    var rgb = fromLab(mL, ma, mb);
    return { colour: rgbHex(rgb[0], rgb[1], rgb[2]), spread: Math.round(Math.min(1, de / n / 40) * 100) / 100 };
  }

  /**
   * SewFigures.captureSwatches(projectId, swatches, source, opts) -> Promise<[SwatchBitmap|null]>
   * opts = { signal, px: 96, onProgress }
   */
  function captureSwatches(projectId, list, source, opts) {
    opts = opts || {};
    var px = num(opts.px, 96);
    var B = blobs();
    var out = (list || []).map(function () { return null; });
    var k = 0;
    function next() {
      if (stopped(opts.signal)) return Promise.reject(abortErr());
      if (k >= (list || []).length) return Promise.resolve(out);
      var i = k++, sw = list[i];
      if (!sw || !sw.rect || typeof sw.page !== 'number') return next();
      // inset 6% so the crop never carries the page around the picture
      var r = sw.rect, ix = (r.x1 - r.x0) * 0.06, iy = (r.y1 - r.y0) * 0.06;
      var lk = { page: sw.page, rect: { x0: r.x0 + ix, y0: r.y0 + iy, x1: r.x1 - ix, y1: r.y1 - iy }, mode: 'swatch' };
      var key = 'p:' + projectId + ':swatch:' + i;
      return regionCanvas(source, lk, px * 2, px * px * 8, opts.signal).then(function (cv) {
        var ctx = cv.getContext('2d');
        var c = colourOf(ctx.getImageData(0, 0, cv.width, cv.height));
        // a near-white, flat crop is the page, not a fabric
        var blank = c.colour && c.spread < 0.04 && /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(c.colour);
        var small = document.createElement('canvas');
        var s = px / Math.max(cv.width, cv.height);
        small.width = Math.max(1, Math.round(cv.width * s)); small.height = Math.max(1, Math.round(cv.height * s));
        small.getContext('2d').drawImage(cv, 0, 0, small.width, small.height);
        release(cv);
        return canvasToBlob(small, 0.85).then(function (blob) {
          release(small);
          var row = { index: i, blobKey: key, colour: c.colour, spread: c.spread, clean: !!sw.clean && !blank };
          if (!blob || !B) { row.blob = blob; return row; }
          return B.put(key, blob).then(function () { return row; });
        });
      }).then(function (row) { out[i] = row; }, function (err) {
        if (err && err.name === 'AbortError') throw err;
      }).then(function () {
        if (typeof opts.onProgress === 'function') { try { opts.onProgress(k, list.length); } catch (e) { /* ignore */ } }
        return next();
      });
    }
    return next();
  }

  // =====================================================================
  // 6. Tape-up map
  // =====================================================================

  var TILE_RE = /^\s*(?:page\s*)?(\d{1,2})\s?([A-Za-z])\s*$|^\s*(?:page\s*)?([A-Za-z])\s?(\d{1,2})\s*$/i;
  function tileLabel(text) {
    var m = TILE_RE.exec(str(text));
    if (!m) return null;
    return m[1] ? m[1] + m[2].toUpperCase() : m[3].toUpperCase() + m[4];
  }

  /**
   * SewFigures.tapeMap(pages) -> TapeMap | null
   * pages: {[n]: PageInfo} or [PageInfo]. The tiles' registration labels are printed
   * where two (or four) sheets meet, so the same label on two pages says where one page
   * sits against the other: page Q is at P + (label position on P - label position on Q),
   * rounded to whole pages. The grid is walked out from the first labelled page.
   */
  /**
   * SewFigures.sheetTapeMap(text, pages) -> TapeMap | null: sew-core's reading of the sheet's
   * text (Sewing.readSheet(text).tiles) when it has one, else this file's own from positions.
   */
  function sheetTapeMap(text, pages) {
    if (text && window.Sewing && typeof window.Sewing.readSheet === 'function') {
      try {
        var sh = window.Sewing.readSheet(text);
        if (sh && sh.tiles && sh.tiles.tiles && sh.tiles.tiles.length) { sh.tiles.source = 'text'; return sh.tiles; }
      } catch (e) { /* fall through to positions */ }
    }
    var own = pages ? tapeMap(pages) : null;
    if (own) own.source = 'positions';
    return own;
  }

  function tapeMap(pages) {
    var list = isArr(pages) ? pages : Object.keys(pages || {}).map(function (k) { return pages[k]; });
    var marks = {};   // label -> [{page, x, y}]
    var own = {};
    var labelled = [];
    list.forEach(function (pg) {
      if (!pg || !pg.lines || !(pg.width > 0)) return;
      var any = false;
      // A line of nothing but tile labels ('1A 2A' along the foot of a sheet) is one label per
      // corner: the first sits at the line's left end, the last at its right end.
      var items = [];
      pg.lines.forEach(function (l) {
        var b = toBox(l.box);
        if (!b) return;
        var parts = str(l.text).replace(/(\d)\s+([A-Za-z])\b/g, '$1$2').split(/\s+/).filter(Boolean);
        if (parts.length >= 2 && parts.every(function (p) { return tileLabel(p); })) {
          var k = parts.length, h = bh(b), cw = Math.min(bw(b) / k, h * 2.5);
          parts.forEach(function (p, i) {
            var cx = k === 1 ? (b.x0 + b.x1) / 2 : b.x0 + cw / 2 + (bw(b) - cw) * i / (k - 1);
            items.push({ text: p, box: box(cx - cw / 2, b.y0, cx + cw / 2, b.y1) });
          });
        } else items.push({ text: l.text, box: b });
      });
      items.forEach(function (l) {
        var lab = tileLabel(l.text), b = l.box;
        if (!lab || !b) return;
        var c = centre(b), nx = c.x / pg.width, ny = c.y / pg.height;
        if (nx > 0.3 && nx < 0.7 && ny > 0.3 && ny < 0.7) { own[pg.page] = lab; any = true; return; }
        (marks[lab] = marks[lab] || []).push({ page: pg.page, x: nx, y: ny });
        any = true;
      });
      if (any) labelled.push(pg.page);
    });
    if (labelled.length < 2) return null;
    // Edges between pages from shared labels.
    var adj = {};
    var edges = 0;
    Object.keys(marks).forEach(function (lab) {
      var ms = marks[lab];
      for (var i = 0; i < ms.length; i++) {
        for (var j = 0; j < ms.length; j++) {
          if (i === j || ms[i].page === ms[j].page) continue;
          var dx = ms[i].x - ms[j].x, dy = ms[i].y - ms[j].y;      // Q - P in pages
          var rx = Math.round(dx), ry = Math.round(dy);
          if ((rx === 0 && ry === 0) || Math.abs(dx - rx) > 0.3 || Math.abs(dy - ry) > 0.3 || Math.abs(rx) > 1 || Math.abs(ry) > 1) continue;
          (adj[ms[i].page] = adj[ms[i].page] || []).push({ to: ms[j].page, dx: rx, dy: ry });
          edges++;
        }
      }
    });
    var pos = {}, conflicts = 0, seenEdges = 0;
    var startPages = labelled.slice().sort(function (a, b) { return a - b; });
    var groups = [];
    startPages.forEach(function (s) {
      if (pos[s] || !adj[s]) return;
      var grp = [s];
      pos[s] = { x: 0, y: 0, g: groups.length };
      var queue = [s];
      while (queue.length) {
        var p = queue.shift();
        (adj[p] || []).forEach(function (e) {
          seenEdges++;
          var want = { x: pos[p].x + e.dx, y: pos[p].y + e.dy };
          if (!pos[e.to]) { pos[e.to] = { x: want.x, y: want.y, g: pos[s].g }; grp.push(e.to); queue.push(e.to); }
          else if (pos[e.to].x !== want.x || pos[e.to].y !== want.y) conflicts++;
        });
      }
      groups.push(grp);
    });
    if (!groups.length) return null;
    groups.sort(function (a, b) { return b.length - a.length; });
    var main = groups[0];
    if (main.length < 2) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    main.forEach(function (p) { minX = Math.min(minX, pos[p].x); minY = Math.min(minY, pos[p].y); maxX = Math.max(maxX, pos[p].x); maxY = Math.max(maxY, pos[p].y); });
    var cells = {};
    var tiles = main.map(function (p) {
      var r = pos[p].y - minY, c = pos[p].x - minX;
      if (cells[r + ',' + c]) conflicts++;
      cells[r + ',' + c] = p;
      return { page: p, row: r, col: c, label: own[p] || '' };
    }).sort(function (a, b) { return a.row - b.row || a.col - b.col; });
    var inMain = {};
    main.forEach(function (p) { inMain[p] = 1; });
    var rows = maxY - minY + 1, cols = maxX - minX + 1;
    var gaps = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (!cells[r + ',' + c]) gaps.push({ row: r, col: c });
    return {
      rows: rows, cols: cols, tiles: tiles,
      gaps: gaps,                                         // places in the grid no page was found for
      loose: labelled.filter(function (p) { return !inMain[p]; }),
      conflicts: conflicts,
      ok: tiles.length >= 4 && conflicts <= Math.max(1, seenEdges * 0.1) && gaps.length <= Math.max(1, rows * cols * 0.2)
    };
  }

  // Positioning rules the hooks need, once; colours come from the theme.
  function ensureCss() {
    if (document.getElementById('sew-visual-css')) return;
    var st = document.createElement('style');
    st.id = 'sew-visual-css';
    st.textContent =
      '.sew-btn-pic{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:0}' +
      '.sew-btn-pic img{width:100%;height:100%;object-fit:cover;transition:opacity .35s ease}' +
      '.sew-btn-pic-host>*:not(.sew-btn-pic){position:relative;z-index:1}' +
      '.sew-tape{display:block;width:100%;height:auto;touch-action:manipulation}' +
      '.sew-tape-tile{cursor:pointer}' +
      '.sew-tape-tile:focus{outline:none}.sew-tape-tile:focus rect{stroke:var(--primary,#36c);stroke-width:3}' +
      '@media (prefers-reduced-motion: reduce){.sew-btn-pic img{transition:none}}';
    document.head.appendChild(st);
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    return e;
  }

  /**
   * SewFigures.mountTapeMap(el, map, opts) -> { update(done), destroy() }
   * opts = { done: {page: true}, onTap(tile), title }
   */
  function mountTapeMap(el, map, opts) {
    opts = opts || {};
    ensureCss();
    var done = opts.done || {};
    var cell = 60, gapPx = 4, W = map.cols * cell + (map.cols - 1) * gapPx, H = map.rows * cell * 1.3 + (map.rows - 1) * gapPx;
    var svg = svgEl('svg', { 'class': 'sew-tape', viewBox: '0 0 ' + W + ' ' + H, role: 'group',
      'aria-label': (opts.title || 'Tape-up map') + ': ' + map.rows + ' rows of ' + map.cols + ' sheets' });
    var nodes = [];
    map.tiles.forEach(function (t) {
      var x = t.col * (cell + gapPx), y = t.row * (cell * 1.3 + gapPx);
      var g = svgEl('g', { 'class': 'sew-tape-tile', tabindex: '0', role: 'button' });
      var r = svgEl('rect', { x: x + 1, y: y + 1, width: cell - 2, height: cell * 1.3 - 2, rx: 4 });
      var tx = svgEl('text', { x: x + cell / 2, y: y + cell * 0.62, 'text-anchor': 'middle', 'font-size': 15 });
      tx.textContent = t.label || String(t.page);
      var sub = svgEl('text', { x: x + cell / 2, y: y + cell * 0.95, 'text-anchor': 'middle', 'font-size': 10 });
      sub.textContent = t.label ? 'p' + t.page : 'page';
      var tick = svgEl('text', { x: x + cell - 8, y: y + 16, 'text-anchor': 'end', 'font-size': 14 });
      g.appendChild(r); g.appendChild(tx); g.appendChild(sub); g.appendChild(tick);
      var fire = function () { if (typeof opts.onTap === 'function') opts.onTap(t); };
      g.addEventListener('click', fire);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
      svg.appendChild(g);
      nodes.push({ t: t, g: g, r: r, tx: tx, sub: sub, tick: tick });
    });
    function paint() {
      nodes.forEach(function (n) {
        var isDone = !!((n.t.label && done[n.t.label]) || done[n.t.page]);
        n.g.setAttribute('class', 'sew-tape-tile' + (isDone ? ' is-done' : ''));
        n.g.setAttribute('aria-pressed', isDone ? 'true' : 'false');
        n.g.setAttribute('aria-label', 'Sheet ' + (n.t.label || ('page ' + n.t.page)) + ', row ' + (n.t.row + 1) + ', column ' + (n.t.col + 1) + (isDone ? ', taped' : ''));
        n.r.setAttribute('style', 'fill:' + (isDone ? 'var(--primary,#36c)' : 'var(--surface,#fff)') + ';stroke:var(--border,#999);stroke-width:1.5');
        var tc = isDone ? 'var(--primary-text,#fff)' : 'var(--text,#222)';
        n.tx.setAttribute('style', 'fill:' + tc + ';font-weight:600');
        n.sub.setAttribute('style', 'fill:' + (isDone ? tc : 'var(--text-muted,#666)'));
        n.tick.setAttribute('style', 'fill:' + tc);
        n.tick.textContent = isDone ? '✓' : '';
      });
    }
    paint();
    el.appendChild(svg);
    return {
      el: svg,
      update: function (d) { done = d || {}; paint(); },
      destroy: function () { if (svg.parentNode) svg.parentNode.removeChild(svg); nodes = []; }
    };
  }

  // =====================================================================
  // 7. The step's picture behind the Step-done label (S4)
  // =====================================================================

  /**
   * SewFigures.mountButtonPicture(buttonEl, { blob | canvas | url, dim }) -> { set(src), clear(), destroy() }
   */
  function mountButtonPicture(btn, opts) {
    opts = opts || {};
    ensureCss();
    var dim = num(opts.dim, 0.28);
    var holder = document.createElement('span');
    holder.className = 'sew-btn-pic';
    holder.setAttribute('aria-hidden', 'true');
    try { if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative'; } catch (e) { /* ignore */ }
    btn.classList.add('sew-btn-pic-host');
    btn.insertBefore(holder, btn.firstChild);
    var url = null, img = null;
    function srcOf(o) {
      if (!o) return null;
      if (typeof o === 'string') return o;
      if (o.url) return o.url;
      if (o.canvas) return o.canvas.toDataURL('image/jpeg', 0.8);
      if (o.blob || (typeof Blob !== 'undefined' && o instanceof Blob)) {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(o.blob || o);
        return url;
      }
      return null;
    }
    function set(o) {
      var s = srcOf(o);
      if (!s) { clear(); return; }
      var next = document.createElement('img');
      next.alt = '';
      next.style.opacity = '0';
      next.onload = function () {
        next.style.opacity = String(dim);
        if (img && img !== next) {
          var old = img;
          old.style.opacity = '0';
          setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 400);
        }
        img = next;
      };
      next.style.position = 'absolute';
      next.style.left = '0'; next.style.top = '0';
      // the label stays readable on any theme: the picture is greyed and dimmed
      next.style.filter = 'grayscale(0.35) contrast(0.9)';
      holder.appendChild(next);
      next.src = s;
    }
    function clear() {
      while (holder.firstChild) holder.removeChild(holder.firstChild);
      img = null;
      if (url) { URL.revokeObjectURL(url); url = null; }
    }
    if (opts.blob || opts.canvas || opts.url) set(opts);
    return {
      set: set, clear: clear,
      destroy: function () { clear(); if (holder.parentNode) holder.parentNode.removeChild(holder); btn.classList.remove('sew-btn-pic-host'); }
    };
  }

  var api = {
    tapeMap: tapeMap,
    sheetTapeMap: sheetTapeMap,
    tileLabel: tileLabel,
    mountTapeMap: mountTapeMap,
    mountButtonPicture: mountButtonPicture,
    swatches: swatches,
    captureSwatches: captureSwatches,
    colourOf: colourOf,
    codesIn: codesIn,
    codeMatch: codeMatch,
    _labelTokens: labelTokens,
    renderCrops: renderCrops,
    cropKey: cropKey,
    deleteCrops: deleteCrops,
    _renderPdfRegion: renderPdfRegion,
    _regionCanvas: regionCanvas,
    readPages: readPages,
    link: link,
    refsIn: refsIn,
    captionKey: captionKey,
    _assignLines: assignLines,
    _columnsOf: columnsOf,
    _graphicRegions: graphicRegions,
    _readOps: readOps,
    _textLines: textLines,
    _drawingRegions: drawingRegions,
    _geo: { box: box, union: union, inter: inter, gap: gap, area: area, norm: norm, cluster: cluster, polyBox: polyBox, fold: fold, toBox: toBox, centre: centre, within: within, pad: pad, overlap1: overlap1 }
  };
  window.SewFigures = api;
})();
