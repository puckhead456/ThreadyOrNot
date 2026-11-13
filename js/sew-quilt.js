// js/sew-quilt.js
// window.SewQuilt - the quilt top that assembles itself (P11 / S2), the active unit in the
// big button (S3) and the cutting board to scale (S5).
//   1. helpers
//   2. reading a vector layout page into blocks / rows / patches (pure)
//   3. progress: which blocks are made (pure)
//   4. mount(): the quilt top on a canvas (grey -> colour, pan / zoom, newest-block reveal)
//   5. mountUnit(): the block being made, n of total
//   6. the cutting board to scale (parseDims / boardModel pure, mountBoard SVG)
// The picture is the pattern's own: the page region rendered by pdf.js (or the stored page
// JPEG) is the colour layer, and the patch polygons from the operator list only decide WHICH
// part of it is shown in colour. Without patch polygons and labels there is no block-by-block
// reveal: the page region is shown whole with a progress ring, and it says so.
// Contract: docs/wave-k/api/sew-visual.md.
'use strict';

(function () {

  // =====================================================================
  // 1. Helpers
  // =====================================================================

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function box(x0, y0, x1, y1) { return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }; }
  function toBox(b) {
    if (!b) return null;
    if (isArr(b) && b.length >= 4) return box(+b[0], +b[1], +b[2], +b[3]);
    if (typeof b.x0 === 'number') return box(b.x0, b.y0, b.x1, b.y1);
    return null;
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
    var r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
    return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
  }
  function gap(a, b) {
    var dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
    var dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
    return Math.sqrt(dx * dx + dy * dy);
  }
  function centre(b) { return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; }
  function polyBox(poly) {
    var b = null;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      b = b ? { x0: Math.min(b.x0, p[0]), y0: Math.min(b.y0, p[1]), x1: Math.max(b.x1, p[0]), y1: Math.max(b.y1, p[1]) }
        : { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
    }
    return b;
  }
  function polyArea(poly) {
    var a = 0;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    return Math.abs(a / 2);
  }
  function polyCentroid(poly) {
    var x = 0, y = 0;
    for (var i = 0; i < poly.length; i++) { x += poly[i][0]; y += poly[i][1]; }
    return { x: x / poly.length, y: y / poly.length };
  }
  /** Even-odd point in polygon. */
  function inPoly(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  function fold(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, ''); }

  // =====================================================================
  // 2. Reading a vector layout page
  // =====================================================================

  // Block labels as quilt layouts print them: 'B1', 'B2a', 'C', 'HC', 'Block 3', 'A'.
  var BLOCK_LABEL_RE = /^(?:block\s+)?([A-Z]{1,2}\d{0,2}[a-z]?)$/;
  var BLOCK_WORD_RE = /^block\s+(\d{1,2}[a-z]?|[A-Z]\d{0,2}[a-z]?)$/i;
  var ROW_LABEL_RE = /^row\s*(\d{1,2})$/i;

  /** A label token's estimated box (a line can hold several labels: 'B3   B3'). */
  function labelTokens(lines, region) {
    var out = [];
    (lines || []).forEach(function (l) {
      var b = toBox(l.box), t = str(l.text);
      if (!b || !t) return;
      var cw = bw(b) / Math.max(1, t.length);
      var re = /\S+(?:\s\d{1,2}(?![\dA-Za-z]))?/g, m;
      var whole = t.replace(/^\s+|\s+$/g, '');
      var rm = ROW_LABEL_RE.exec(whole);
      if (rm) { out.push({ kind: 'row', label: 'Row ' + rm[1], n: +rm[1], box: b }); return; }
      var bm = BLOCK_WORD_RE.exec(whole);
      if (bm) { out.push({ kind: 'block', label: bm[1], box: b }); return; }
      while ((m = re.exec(t))) {
        var tok = m[0];
        var r2 = ROW_LABEL_RE.exec(tok);
        var tb = box(b.x0 + m.index * cw, b.y0, b.x0 + (m.index + tok.length) * cw, b.y1);
        if (r2) { out.push({ kind: 'row', label: 'Row ' + r2[1], n: +r2[1], box: tb }); continue; }
        if (BLOCK_LABEL_RE.test(tok)) out.push({ kind: 'block', label: tok, box: tb });
      }
    });
    if (region) out = out.filter(function (t) { var c = centre(t.box); return c.x >= region.x0 - 40 && c.x <= region.x1 + 40 && c.y >= region.y0 - 30 && c.y <= region.y1 + 30; });
    return out;
  }

  /** Cluster touching boxes. */
  function clusterBoxes(items, tol) {
    // grid-bucket single-link clustering (fast enough for a few thousand shapes)
    var parent = items.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    var cell = 40, grid = {};
    items.forEach(function (it, i) {
      var b = it.box;
      for (var gx = Math.floor((b.x0 - tol) / cell); gx <= Math.floor((b.x1 + tol) / cell); gx++) {
        for (var gy = Math.floor((b.y0 - tol) / cell); gy <= Math.floor((b.y1 + tol) / cell); gy++) {
          var k = gx + ',' + gy;
          var list = grid[k] || (grid[k] = []);
          for (var q = 0; q < list.length; q++) {
            var j = list[q];
            if (find(i) !== find(j) && gap(b, items[j].box) <= tol) parent[find(i)] = find(j);
          }
          list.push(i);
        }
      }
    });
    var groups = {};
    items.forEach(function (it, i) { var r = find(i); (groups[r] = groups[r] || []).push(i); });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  function lum(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(str(hex));
    if (!m) return null;
    return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
  }

  /**
   * SewQuilt.fromShapes(pageInfo, fabric, opts) -> QuiltModel | null
   * pageInfo needs `shapes` (SewFigures.readPages(.., {shapes:true})) and `lines`.
   */
  function fromShapes(pg, fabric, opts) {
    opts = opts || {};
    if (!pg || !isArr(pg.shapes) || !(pg.width > 0)) return null;
    var W = pg.width, H = pg.height, PA = W * H;
    var shapes = [];
    pg.shapes.forEach(function (s, i) {
      if (!s || !s.poly || s.poly.length < 3) return;
      var b = toBox(s.box) || polyBox(s.poly);
      var a = area(b);
      if (a > PA * 0.85 || a < PA * 0.00003) return;
      if (b.y1 < H * 0.05 || b.y0 > H * 0.95) return;   // running head, footer
      // white page-coloured fills are knock-outs, not patches
      if (s.fill && !s.image && lum(s.fill) > 0.985) return;
      shapes.push({ i: i, poly: s.poly, box: b, fill: s.fill || null, image: s.image || null });
    });
    if (shapes.length < 6) return null;
    var groups = clusterBoxes(shapes, 1.5);
    groups.sort(function (a, b) {
      var ba = null, bb = null;
      a.forEach(function (i) { ba = union(ba, shapes[i].box); });
      b.forEach(function (i) { bb = union(bb, shapes[i].box); });
      return area(bb) * Math.sqrt(b.length) - area(ba) * Math.sqrt(a.length);
    });
    var main = groups[0];
    if (!main || main.length < 6) return null;
    // A frame or clip that spans the whole top is not a patch: drop the biggest shapes while
    // each covers more than 40% of what the rest cover (it would swallow every block).
    var dropped = {};
    for (var guard = 0; guard < 6; guard++) {
      var rest = null, big = -1;
      main.forEach(function (i) {
        if (dropped[i]) return;
        if (big < 0 || area(shapes[i].box) > area(shapes[big].box)) big = i;
      });
      main.forEach(function (i) { if (!dropped[i] && i !== big) rest = union(rest, shapes[i].box); });
      if (big >= 0 && rest && area(shapes[big].box) > area(rest) * 0.4) dropped[big] = 1; else break;
    }
    main = main.filter(function (i) { return !dropped[i]; });
    // without the frame, what it bridged (a logo, a caption box) falls away
    var sub = clusterBoxes(main.map(function (i) { return shapes[i]; }), 1.5);
    sub.sort(function (a, b) { return b.length - a.length; });
    var keepSet = {};
    sub[0].forEach(function (k) { keepSet[main[k]] = 1; });
    shapes.forEach(function (s, i) { if (dropped[i] || (main.indexOf(i) >= 0 && !keepSet[i])) s.drop = true; });
    main = main.filter(function (i) { return keepSet[i]; });
    if (main.length < 6) return null;
    var qb = null;
    main.forEach(function (i) { qb = union(qb, shapes[i].box); });
    if (area(qb) < PA * 0.05) return null;
    // Patches: the shapes inside the quilt's box, in paint order; a later shape that covers
    // an earlier one exactly replaces it (a fill then an image clipped to the same outline).
    var patches = [];
    var bySig = {};
    shapes.forEach(function (s) {
      if (s.drop) return;
      var c = centre(s.box);
      if (c.x < qb.x0 || c.x > qb.x1 || c.y < qb.y0 || c.y > qb.y1) return;
      var sig = [s.box.x0, s.box.y0, s.box.x1, s.box.y1].map(function (v) { return Math.round(v * 2); }).join(',');
      var p = { id: 'p' + patches.length, poly: s.poly, box: s.box, fill: s.fill, image: s.image, fabric: null, block: null, row: null,
        area: polyArea(s.poly) };
      if (bySig[sig] !== undefined) { var old = patches[bySig[sig]]; old.fill = s.fill || old.fill; old.image = s.image || old.image; return; }
      bySig[sig] = patches.length;
      patches.push(p);
    });
    // The quilt's own outline (a big shape spanning the whole top) is a background, not a patch.
    patches = patches.filter(function (p) { return !(area(p.box) > area(qb) * 0.9 && patches.length > 8); });
    patches.forEach(function (p, i) { p.id = 'p' + i; });
    if (patches.length < 4) return null;

    var toks = labelTokens(pg.lines, qb);
    var rowToks = toks.filter(function (t) { return t.kind === 'row'; });
    var blockToks = toks.filter(function (t) { return t.kind === 'block'; });
    var model = {
      mode: 'vector', page: pg.page, pageW: W, pageH: H,
      box: { x0: qb.x0 / W, y0: qb.y0 / H, x1: qb.x1 / W, y1: qb.y1 / H }, region: qb,
      w: bw(qb), h: bh(qb),
      patches: patches, blocks: [], rows: [], labels: 'none', reason: ''
    };

    // Block labels: a label inside the quilt names the patch it sits in and the patches
    // nearest it (each patch goes to the nearest label inside or touching its block cell).
    var inside = blockToks.filter(function (t) { var c = centre(t.box); return c.x >= qb.x0 && c.x <= qb.x1 && c.y >= qb.y0 && c.y <= qb.y1; });
    if (inside.length >= 2) {
      var blocks = inside.map(function (t, k) {
        return { id: 'b' + k, label: t.label, at: centre(t.box), box: null, patches: [], row: null };
      });
      // A patch belongs to the label whose point is nearest its centroid, and only when
      // that label is clearly nearer than the second (otherwise it is sashing / border).
      // Distance is to the patch's box (0 when the label sits on it), so a long border strip
      // labelled at one end is still that label's; ties go by centroid distance.
      var unit = Math.min(model.w, model.h);
      // The spacing of the labels (median distance to the nearest other label) is the size
      // of a block; a patch much longer than that, holding no label, is sashing or border.
      var nn = blocks.map(function (b) {
        var m = Infinity;
        blocks.forEach(function (o) { if (o !== b) m = Math.min(m, Math.hypot(o.at.x - b.at.x, o.at.y - b.at.y)); });
        return m;
      }).sort(function (a, b) { return a - b; });
      var spacing = nn[Math.floor(nn.length / 2)] || unit;
      patches.forEach(function (p, pi) {
        var holdsOne = blocks.some(function (b) { return inPoly(b.at, p.poly); });
        if (!holdsOne && Math.max(bw(p.box), bh(p.box)) > spacing * 1.6) return;
        var c = polyCentroid(p.poly), best = -1, bd = Infinity, second = Infinity;
        blocks.forEach(function (b, bi) {
          var dx = Math.max(0, p.box.x0 - b.at.x, b.at.x - p.box.x1), dy = Math.max(0, p.box.y0 - b.at.y, b.at.y - p.box.y1);
          var d = (dx === 0 && dy === 0 && inPoly(b.at, p.poly)) ? 0 : Math.hypot(dx, dy) + Math.hypot(b.at.x - c.x, b.at.y - c.y) * 0.25 + 0.01;
          if (d < bd) { second = bd; bd = d; best = bi; } else if (d < second) second = d;
        });
        if (best < 0) return;
        // a patch holding two labels' points (a big background) belongs to neither
        var holds = 0;
        blocks.forEach(function (b) { if (inPoly(b.at, p.poly)) holds++; });
        if (holds > 1) return;
        if (bd === 0 || second - bd > unit * 0.03) {
          p.block = blocks[best].id;
          blocks[best].patches.push(pi);
          blocks[best].box = union(blocks[best].box, p.box);
        }
      });
      blocks = blocks.filter(function (b) { return b.patches.length || b.cell; });
      blocks.forEach(function (b) {
        delete b.at;
        if (b.cell) { b.outline = b.cell.poly; b.box = union(b.box, b.cell.box); }
        delete b.cell;
      });
      model.blocks = blocks;
      model.labels = blocks.length >= 2 ? 'blocks' : 'none';
      model.reason = blocks.length + ' labelled blocks';
    }
    // Row labels ('ROW 1'…'ROW 8' beside the quilt): bands between their mid-points.
    if (model.labels === 'none' && rowToks.length >= 2) {
      rowToks.sort(function (a, b) { return centre(a.box).y - centre(b.box).y; });
      var ys = rowToks.map(function (t) { return centre(t.box).y; });
      var rows = rowToks.map(function (t, k) {
        var top = k === 0 ? qb.y0 : (ys[k - 1] + ys[k]) / 2;
        var bot = k === ys.length - 1 ? qb.y1 : (ys[k] + ys[k + 1]) / 2;
        return { id: 'r' + t.n, label: t.label, n: t.n, box: box(qb.x0, top, qb.x1, bot), blocks: [], patches: [] };
      });
      patches.forEach(function (p, pi) {
        var c = polyCentroid(p.poly);
        for (var k = 0; k < rows.length; k++) if (c.y >= rows[k].box.y0 && c.y < rows[k].box.y1) { p.row = rows[k].id; rows[k].patches.push(pi); break; }
      });
      model.rows = rows;
      // Each row is one "block" for progress and drawing.
      model.blocks = rows.map(function (r) { return { id: r.id, label: r.label, box: r.box, patches: r.patches, row: r.id }; });
      model.labels = 'rows';
      model.reason = rows.length + ' rows labelled on the page';
    }
    if (model.labels === 'none') model.reason = 'the layout has no block or row labels';
    // Fabric per patch: an image clipped into it is a fabric print; a fill colour is matched
    // to nothing (a flat colour says nothing about which fabric it is) unless opts.fills maps it.
    if (opts.fills) patches.forEach(function (p) { if (p.fill && opts.fills[p.fill] !== undefined) p.fabric = opts.fills[p.fill]; });
    return model;
  }

  /** A model that is only the page picture: honest when the layout cannot be read. */
  function pictureModel(page, rect, why) {
    var r = rect || { x0: 0, y0: 0, x1: 1, y1: 1 };
    return { mode: 'picture', page: page, box: r, patches: [], blocks: [], rows: [], labels: 'none',
      reason: why || 'the layout page is a picture' };
  }

  /** SewQuilt.findLayout(pages, fabric) -> { page, model } | null: the best vector layout among pages. */
  function findLayout(pages, fabric, opts) {
    var best = null;
    Object.keys(pages || {}).forEach(function (k) {
      var pg = pages[k];
      if (!pg || !pg.shapes) return;
      var m = fromShapes(pg, fabric, opts);
      if (!m) return;
      var score = (m.labels !== 'none' ? 1000 : 0) + m.blocks.length * 10 + Math.min(500, m.patches.length);
      // a page that says it is the layout wins ties
      var says = (pg.lines || []).some(function (l) { return /quilt\s+(?:layout|assembly|diagram)|layout\s+diagram/i.test(l.text); });
      if (says) score += 5000;   // the page that calls itself the layout wins
      if (!best || score > best.score) best = { page: pg.page, model: m, score: score };
    });
    return best ? { page: best.page, model: best.model } : null;
  }

  var LAYOUT_WORDS_RE = /quilt\s+(?:layout|assembly|top\s+assembly|diagram)|layout\s+diagram|assembly\s+diagram|join\s+(?:the\s+)?rows|sew\s+(?:the\s+)?rows\s+together/i;

  /**
   * SewQuilt.findPicture(pages) -> QuiltModel (mode 'picture') | null: a page that says it is
   * the layout and carries one big picture (Joyous p6). The honest fallback for P11.
   */
  function findPicture(pages) {
    var best = null;
    Object.keys(pages || {}).forEach(function (k) {
      var pg = pages[k];
      if (!pg || !pg.lines || !(pg.width > 0)) return;
      if (!pg.lines.some(function (l) { return LAYOUT_WORDS_RE.test(l.text); })) return;
      var PA = pg.width * pg.height;
      (pg.images || []).forEach(function (im) {
        var b = toBox(im.box);
        if (!b) return;
        var a = area(b);
        // a big picture, but not the page itself (a scan) or a sliver (a page-edge band)
        if (a < PA * 0.2 || a > PA * 0.92 || Math.min(bw(b), bh(b)) < pg.width * 0.25) return;
        if (!best || a > best.a) best = { a: a, page: pg.page, rect: { x0: b.x0 / pg.width, y0: b.y0 / pg.height, x1: b.x1 / pg.width, y1: b.y1 / pg.height } };
      });
    });
    return best ? pictureModel(best.page, best.rect, 'the layout on page ' + best.page + ' is a picture, so it fills in as a whole') : null;
  }

  // =====================================================================
  // 3. Progress
  // =====================================================================

  // Keys that join a counter's name to a layout label. A unit is not a block: Harmony's
  // "Unit 2a" is a part of Block 1, not the block labelled B2a, so units join only labels
  // printed as units (U2a) and blocks join B-labels or bare numbers.
  function unitKey(name) {
    var t = str(name).replace(/^\s+|\s+$/g, '');
    var m = /^row\s*(\d+)/i.exec(t);
    if (m) return 'row' + m[1];
    m = /^(unit|block|blk)\s*([a-z]?\d{1,2}[a-z]?)\b/i.exec(t);
    if (m) return (/^u/i.test(m[1]) ? 'u' : 'b') + m[2].toLowerCase().replace(/^[a-z](?=\d)/, '');
    return null;
  }
  function labelKey(label) {
    var t = str(label);
    var m = /^row\s*(\d+)/i.exec(t);
    if (m) return 'row' + m[1];
    m = /^([BU])(\d{1,2}[a-z]?)$/.exec(t);
    if (m) return m[1].toLowerCase() + m[2].toLowerCase();
    if (/^\d{1,2}[a-z]?$/.test(t)) return 'b' + t.toLowerCase();
    return null;
  }

  /**
   * SewQuilt.progress(model, craftData) -> { byBlock, done, total, mapping, newest }
   * Blocks sharing a label share their unit: 4 × B3 and "make 4 Unit 3" light one B3 per unit.
   */
  function progress(model, d, prev) {
    var out = { byBlock: {}, done: 0, total: 0, mapping: 'order', newest: null };
    if (!model) return out;
    d = d || {};
    var units = isArr(d.units) ? d.units : [], steps = isArr(d.steps) ? d.steps : [];
    var blocks = model.blocks || [];
    out.total = blocks.length;
    var byLabel = {};
    blocks.forEach(function (b, i) { var k = labelKey(b.label); if (k) (byLabel[k] = byLabel[k] || []).push(i); });
    var frac = blocks.map(function () { return null; });
    var mapped = 0;
    // 1. units ↔ labels
    units.forEach(function (u) {
      var k = unitKey(u.name);
      if (!k || !byLabel[k]) return;
      var idx = byLabel[k], T = Math.max(1, num(u.target, 0)), D = Math.max(0, Math.min(T, num(u.done, 0)));
      var per = T / idx.length;
      idx.forEach(function (bi, n) {
        frac[bi] = Math.max(0, Math.min(1, (D - n * per) / per));
      });
      mapped += idx.length;
    });
    if (mapped) out.mapping = 'units';
    // 1b. sew-core's quilt-top model: each labelled block with the printed step that makes it
    // (Sewing.quiltTop(d).blocks = [{label, step}]); the block is made when that step is done.
    if (!mapped && window.Sewing && typeof window.Sewing.quiltTop === 'function') {
      var qt = null;
      try { qt = window.Sewing.quiltTop(d); } catch (e) { qt = null; }
      var stepOf = {};
      ((qt && qt.blocks) || []).forEach(function (qb) { if (qb && qb.label && qb.step !== null && qb.step !== undefined) stepOf[qb.label] = qb.step; });
      blocks.forEach(function (b, bi) {
        if (stepOf[b.label] === undefined) return;
        var hit = null;
        steps.forEach(function (s) { if (!hit && s && (s.n === stepOf[b.label])) hit = s; });
        if (!hit) return;
        frac[bi] = hit.done ? 1 : 0;
        mapped++;
      });
      if (mapped) out.mapping = 'blocks';
    }
    // 2. steps naming a block or row ('Join Row 3', 'Make Block B2a')
    if (!mapped) {
      blocks.forEach(function (b, bi) {
        var lab = str(b.label);
        if (!lab) return;
        var re = /^row/i.test(lab) ? new RegExp('\\brows?\\s*' + lab.replace(/\D/g, '') + '\\b', 'i')
          : new RegExp('\\b(?:block|unit)?\\s*' + lab.replace(/[^A-Za-z0-9]/g, '') + '\\b');
        var named = steps.filter(function (s) { return s && re.test(str(s.text)); });
        if (!named.length || named.length > 3) return;
        frac[bi] = named.every(function (s) { return s.done; }) ? 1 : 0;
        mapped++;
      });
      if (mapped) out.mapping = /^row/i.test(str(blocks[0] && blocks[0].label)) ? 'rows' : 'steps';
    }
    // 3. layout order of the overall fraction (the honest last resort, labelled as such)
    if (!mapped) {
      var tot = 0, dn = 0;
      if (units.length) units.forEach(function (u) { tot += Math.max(0, num(u.target, 0)); dn += Math.max(0, Math.min(num(u.target, 0), num(u.done, 0))); });
      else steps.forEach(function (s) { if (s && !s.optional) { tot++; if (s.done) dn++; } });
      var f = tot ? dn / tot : 0;
      var order = blocks.map(function (b, i) { return i; }).sort(function (a, c) {
        var A = blocks[a].box, C = blocks[c].box;
        return Math.abs(A.y0 - C.y0) > Math.min(bh(A), bh(C)) * 0.5 ? A.y0 - C.y0 : A.x0 - C.x0;
      });
      var lit = f * blocks.length;
      order.forEach(function (bi, n) { frac[bi] = Math.max(0, Math.min(1, lit - n)); });
      out.fraction = f;
    }
    blocks.forEach(function (b, i) {
      var v = frac[i] === null ? 0 : round2(frac[i]);
      out.byBlock[b.id] = v;
      if (v >= 1) out.done++;
      if (prev && prev.byBlock && (prev.byBlock[b.id] || 0) < 1 && v >= 1) out.newest = b.id;
    });
    if (out.fraction === undefined) out.fraction = out.total ? out.done / out.total : 0;
    return out;
  }

  // =====================================================================
  // 4. mount(): the quilt top
  // =====================================================================

  function cssVar(el, name, d) {
    try { var v = getComputedStyle(el).getPropertyValue(name); return v && v.trim() ? v.trim() : d; } catch (e) { return d; }
  }
  function prefersReduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  /** A grey copy of a picture (luma, lifted so it reads as "not made yet"). */
  function greyOf(src, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.drawImage(src, 0, 0, w, h);
    try {
      var id = x.getImageData(0, 0, w, h), d = id.data;
      for (var i = 0; i < d.length; i += 4) {
        var l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        l = 150 + l * 0.38;
        d[i] = d[i + 1] = d[i + 2] = l;
      }
      x.putImageData(id, 0, 0);
    } catch (e) { /* tainted: keep colour, dimmed by alpha below */ }
    return c;
  }

  /**
   * SewQuilt.mount(canvas, model, opts) -> controller
   * opts = { image: CanvasImageSource of model.box (the page region), progress,
   *          swatches:{fabricIndex: CanvasImageSource}, onTapBlock(block), reducedMotion, label }
   */
  function mount(canvas, model, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var reduced = opts.reducedMotion !== undefined ? !!opts.reducedMotion : prefersReduced();
    var prog = opts.progress || { byBlock: {}, done: 0, total: 0, fraction: 0 };
    var image = opts.image || null, grey = null;
    var swatches = opts.swatches || {};
    var view = { s: 1, tx: 0, ty: 0 };
    var anim = null, raf = 0, destroyed = false;
    var region = model.region || (model.pageW ? { x0: model.box.x0 * model.pageW, y0: model.box.y0 * model.pageH, x1: model.box.x1 * model.pageW, y1: model.box.y1 * model.pageH } : null);
    var mw = region ? bw(region) : (image ? image.width : 100), mh = region ? bh(region) : (image ? image.height : 100);
    var paths2d = {};
    canvas.setAttribute('role', 'img');
    if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
    canvas.style.touchAction = 'none';

    function dpr() { return Math.max(1, Math.min(3, window.devicePixelRatio || 1)); }
    function size() {
      var r = canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round((r.width || canvas.width) * dpr())), h = Math.max(1, Math.round((r.height || canvas.height) * dpr()));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    function fit() {
      size();
      var pad = 10 * dpr();
      var s = Math.min((canvas.width - pad * 2) / mw, (canvas.height - pad * 2) / mh);
      view.s = s > 0 ? s : 1;
      view.tx = (canvas.width - mw * view.s) / 2;
      view.ty = (canvas.height - mh * view.s) / 2;
      draw();
    }
    function blockPath(b) {
      if (paths2d[b.id]) return paths2d[b.id];
      var p = new Path2D();
      // every outline wound the same way, so overlapping patches add up under the nonzero rule
      var add = function (poly) {
        var s = 0;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
        var pts = s < 0 ? poly.slice().reverse() : poly;
        p.moveTo(pts[0][0] - region.x0, pts[0][1] - region.y0);
        for (var k = 1; k < pts.length; k++) p.lineTo(pts[k][0] - region.x0, pts[k][1] - region.y0);
        p.closePath();
      };
      if (b.outline) add(b.outline);
      (b.patches || []).forEach(function (pi) { add(model.patches[pi].poly); });
      paths2d[b.id] = p;
      return p;
    }
    function drawVectorPatches(colour) {
      model.patches.forEach(function (p) {
        var poly = p.poly;
        ctx.beginPath();
        ctx.moveTo(poly[0][0] - region.x0, poly[0][1] - region.y0);
        for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0] - region.x0, poly[i][1] - region.y0);
        ctx.closePath();
        var sw = p.fabric !== null && swatches[p.fabric];
        if (colour && sw) {
          try { ctx.fillStyle = ctx.createPattern(sw, 'repeat'); } catch (e) { ctx.fillStyle = p.fill || '#ccc'; }
        } else if (colour) ctx.fillStyle = p.fill || '#bbb';
        else { var l = lum(p.fill); ctx.fillStyle = 'rgb(' + Math.round(150 + (l === null ? 0.7 : l) * 97) + ',' + Math.round(150 + (l === null ? 0.7 : l) * 97) + ',' + Math.round(150 + (l === null ? 0.7 : l) * 97) + ')'; }
        ctx.fill();
      });
    }
    function drawLayer(colour) {
      if (image) {
        if (!colour && !grey) grey = greyOf(image, image.width, image.height);
        ctx.drawImage(colour ? image : grey, 0, 0, mw, mh);
      } else if (model.mode === 'vector') drawVectorPatches(colour);
    }
    function ring(f) {
      var r = 22 * dpr(), cx = canvas.width - r - 12 * dpr(), cy = r + 12 * dpr();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = 5 * dpr();
      ctx.strokeStyle = cssVar(canvas, '--border', '#ccc');
      ctx.fillStyle = cssVar(canvas, '--surface', '#fff');
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = cssVar(canvas, '--primary', '#36c');
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, f))); ctx.stroke();
      ctx.fillStyle = cssVar(canvas, '--text', '#222');
      ctx.font = '600 ' + Math.round(12 * dpr()) + 'px ' + cssVar(canvas, '--font-body', 'sans-serif');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(f * 100) + '%', cx, cy);
      ctx.restore();
    }
    function draw() {
      if (destroyed) return;
      raf = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = cssVar(canvas, '--surface-2', cssVar(canvas, '--surface', '#f4f4f4'));
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(view.s, 0, 0, view.s, view.tx, view.ty);
      var now = Date.now(), animating = false;
      if (model.mode === 'picture' || !model.blocks.length) {
        // Honest picture mode: the page's own layout, fading up as the project goes on.
        var f = num(prog.fraction, 0);
        ctx.globalAlpha = 1; drawLayer(false);
        ctx.globalAlpha = 0.25 + 0.75 * f; drawLayer(true);
        ctx.globalAlpha = 1;
        ring(f);
      } else if (prog.total && prog.done >= prog.total && !anim) {
        // every block made: the sashing and borders come in too, the whole top in colour
        drawLayer(true);
      } else {
        drawLayer(false);
        model.blocks.forEach(function (b) {
          var v = num(prog.byBlock[b.id], 0);
          var a = v >= 1 ? 1 : v * 0.45;     // a block under way shows faintly
          if (anim && anim.id === b.id) {
            var t = Math.min(1, (now - anim.t0) / anim.ms);
            a = t * a + (1 - t) * anim.from;
            if (t < 1) animating = true; else anim = null;
          }
          if (a <= 0) return;
          ctx.save();
          ctx.clip(blockPath(b));
          ctx.globalAlpha = a;
          drawLayer(true);
          ctx.restore();
        });
        if (anim && animating) {
          // a running stitch line round the newest block
          var b2 = null;
          model.blocks.forEach(function (b) { if (b.id === anim.id) b2 = b; });
          if (b2) {
            ctx.save();
            ctx.lineWidth = 2 / view.s * dpr();
            ctx.setLineDash([6 / view.s * dpr(), 4 / view.s * dpr()]);
            ctx.lineDashOffset = -(now - anim.t0) / 30 / view.s;
            ctx.strokeStyle = cssVar(canvas, '--primary', '#36c');
            ctx.stroke(blockPath(b2));
            ctx.restore();
          }
        }
      }
      if (animating) raf = requestAnimationFrame(draw);
    }
    function schedule() { if (!raf && !destroyed) raf = requestAnimationFrame(draw); }
    function describe() {
      var lbl = opts.label || 'Quilt top';
      if (model.mode === 'picture' || !model.blocks.length) return lbl + ': the pattern\u2019s layout picture, ' + Math.round(num(prog.fraction, 0) * 100) + '% made. This layout is a picture, so it fills in as a whole.';
      return lbl + ': ' + prog.done + ' of ' + prog.total + (model.labels === 'rows' ? ' rows' : ' blocks') + ' made.';
    }

    // ---- hit-testing, pan and zoom ----
    function toModel(cx, cy) {
      var r = canvas.getBoundingClientRect();
      var x = (cx - r.left) * dpr(), y = (cy - r.top) * dpr();
      return { x: (x - view.tx) / view.s + (region ? region.x0 : 0), y: (y - view.ty) / view.s + (region ? region.y0 : 0) };
    }
    function hitModel(pt) {
      for (var i = model.blocks.length - 1; i >= 0; i--) {
        var b = model.blocks[i];
        if (!b.box || pt.x < b.box.x0 || pt.x > b.box.x1 || pt.y < b.box.y0 || pt.y > b.box.y1) continue;
        if (b.outline && inPoly(pt, b.outline)) return b;
        for (var k = 0; k < b.patches.length; k++) if (inPoly(pt, model.patches[b.patches[k]].poly)) return b;
      }
      return null;
    }
    var pointers = {}, drag = null, moved = false;
    function onDown(e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      moved = false;
      drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, s: view.s, dist: pinchDist() };
    }
    function pinchDist() {
      var ks = Object.keys(pointers);
      if (ks.length < 2) return 0;
      var a = pointers[ks[0]], b = pointers[ks[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    function zoomAt(f, cx, cy) {
      var r = canvas.getBoundingClientRect();
      var x = (cx - r.left) * dpr(), y = (cy - r.top) * dpr();
      var ns = Math.max(0.05, Math.min(view.s * 12, view.s * f));
      view.tx = x - (x - view.tx) * ns / view.s;
      view.ty = y - (y - view.ty) * ns / view.s;
      view.s = ns;
      schedule();
    }
    function onMove(e) {
      if (!pointers[e.pointerId] || !drag) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var d = pinchDist();
      if (d && drag.dist) {
        var ks = Object.keys(pointers), a = pointers[ks[0]], b = pointers[ks[1]];
        var f = d / drag.dist;
        drag.dist = d;
        zoomAt(f, (a.x + b.x) / 2, (a.y + b.y) / 2);
        moved = true;
        return;
      }
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) { view.tx = drag.tx + dx * dpr(); view.ty = drag.ty + dy * dpr(); schedule(); }
    }
    function onUp(e) {
      var was = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (!was) return;
      if (!moved && typeof opts.onTapBlock === 'function') {
        var b = hitModel(toModel(e.clientX, e.clientY));
        if (b) opts.onTapBlock(b);
      }
      drag = Object.keys(pointers).length ? { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, s: view.s, dist: pinchDist() } : null;
    }
    function onWheel(e) {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }
    function onKey(e) {
      var r = canvas.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (e.key === '+' || e.key === '=') { zoomAt(1.25, cx, cy); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { zoomAt(0.8, cx, cy); e.preventDefault(); }
      else if (e.key === '0') { fit(); e.preventDefault(); }
      else if (/^Arrow/.test(e.key)) {
        var step = 30 * dpr();
        if (e.key === 'ArrowLeft') view.tx += step; if (e.key === 'ArrowRight') view.tx -= step;
        if (e.key === 'ArrowUp') view.ty += step; if (e.key === 'ArrowDown') view.ty -= step;
        schedule(); e.preventDefault();
      }
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    var ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(function () { fit(); }); ro.observe(canvas); }

    canvas.setAttribute('aria-label', describe());
    fit();

    return {
      setProgress: function (p) {
        var newest = p && p.newest;
        if (newest && !reduced) {
          anim = { id: newest, t0: Date.now(), ms: 700, from: 0 };
        }
        prog = p || prog;
        canvas.setAttribute('aria-label', describe());
        schedule();
      },
      setImage: function (img) { image = img; grey = null; schedule(); },
      setSwatches: function (map) { swatches = map || {}; schedule(); },
      fit: fit,
      zoomBy: function (f) { var r = canvas.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); },
      hit: function (x, y) { return hitModel({ x: x, y: y }); },
      view: function () { return { s: view.s, tx: view.tx, ty: view.ty }; },
      redraw: draw,
      destroy: function () {
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('keydown', onKey);
        grey = null; image = null; paths2d = {};
      }
    };
  }

  // =====================================================================
  // 5. mountUnit(): the block being made
  // =====================================================================

  /**
   * SewQuilt.mountUnit(el, { name, done, target, model, block, image }) -> { update(state), destroy() }
   * `block` is a block id (or label) of `model`; `image` the model's colour picture.
   */
  function mountUnit(el, state) {
    state = state || {};
    var wrap = document.createElement('span');
    wrap.className = 'sew-unit-pic';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    var cv = document.createElement('canvas');
    cv.width = 112; cv.height = 112;
    cv.style.width = '56px'; cv.style.height = '56px';
    cv.style.borderRadius = '6px';
    var txt = document.createElement('span');
    txt.style.fontVariantNumeric = 'tabular-nums';
    wrap.appendChild(cv); wrap.appendChild(txt);
    el.appendChild(wrap);
    function blockOf(s) {
      if (!s.model || !s.model.blocks) return null;
      var hit = null;
      s.model.blocks.forEach(function (b) { if (!hit && (b.id === s.block || b.label === s.block)) hit = b; });
      if (!hit && s.name) {
        var k = unitKey(s.name);
        s.model.blocks.forEach(function (b) { if (!hit && k && labelKey(b.label) === k) hit = b; });
      }
      return hit;
    }
    function paint() {
      var c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      var T = Math.max(0, num(state.target, 0)), D = Math.max(0, Math.min(T || Infinity, num(state.done, 0)));
      var b = blockOf(state);
      var m = state.model;
      if (b && m && m.region) {
        var bb = b.box, s = Math.min(cv.width / bw(bb), cv.height / bh(bb)) * 0.9;
        c.save();
        c.translate((cv.width - bw(bb) * s) / 2, (cv.height - bh(bb) * s) / 2);
        c.scale(s, s);
        c.translate(-bb.x0, -bb.y0);
        var path = new Path2D();
        b.patches.forEach(function (pi) {
          var poly = m.patches[pi].poly;
          path.moveTo(poly[0][0], poly[0][1]);
          for (var i = 1; i < poly.length; i++) path.lineTo(poly[i][0], poly[i][1]);
          path.closePath();
        });
        c.clip(path);
        if (state.image) c.drawImage(state.image, m.region.x0, m.region.y0, bw(m.region), bh(m.region));
        else b.patches.forEach(function (pi) {
          var p = m.patches[pi];
          c.fillStyle = p.fill || '#bbb';
          c.beginPath();
          c.moveTo(p.poly[0][0], p.poly[0][1]);
          for (var i = 1; i < p.poly.length; i++) c.lineTo(p.poly[i][0], p.poly[i][1]);
          c.fill();
        });
        c.restore();
      } else {
        // no picture of this unit: a ring of the count
        var r = 46, f = T ? D / T : 0;
        c.lineWidth = 10;
        c.strokeStyle = cssVar(el, '--border', '#ccc');
        c.beginPath(); c.arc(56, 56, r, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = cssVar(el, '--primary-text', cssVar(el, '--primary', '#36c'));
        c.beginPath(); c.arc(56, 56, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); c.stroke();
      }
      txt.textContent = (state.name ? state.name + ' \u00b7 ' : '') + D + ' of ' + T;
    }
    paint();
    return {
      el: wrap,
      update: function (s) { for (var k in s) if (s.hasOwnProperty(k)) state[k] = s[k]; paint(); },
      destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  // =====================================================================
  // 6. The cutting board to scale
  // =====================================================================

  var FRAC = { '\u00bd': 0.5, '\u00bc': 0.25, '\u00be': 0.75, '\u215b': 0.125, '\u215c': 0.375, '\u215d': 0.625, '\u215e': 0.875, '\u2153': 1 / 3, '\u2154': 2 / 3 };
  /** '3½', '2 1/2', '10', '4.5' -> number */
  function parseMeasure(t) {
    t = str(t).replace(/^\s+|\s+$/g, '');
    var m = /^(\d+(?:\.\d+)?)?\s*([\u00bd\u00bc\u00be\u215b-\u215e\u2153\u2154])$/.exec(t);
    if (m) return (m[1] ? parseFloat(m[1]) : 0) + FRAC[m[2]];
    m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
    if (m) return +m[1] + (+m[2]) / (+m[3]);
    m = /^(\d+)\/(\d+)$/.exec(t);
    if (m) return (+m[1]) / (+m[2]);
    m = /^(\d+(?:[.,]\d+)?)$/.exec(t);
    if (m) return parseFloat(m[1].replace(',', '.'));
    return null;
  }
  // mixed numbers first, so '7 5/8' is not read as '7'
  var MEAS = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[\\u00bd\\u00bc\\u00be\\u215b-\\u215e\\u2153\\u2154])?|[\\u00bd\\u00bc\\u00be\\u215b-\\u215e])';
  var UNIT = '\\s*(\"|\u201d|\'\'|in(?:ch(?:es)?)?\\b|cm\\b|mm\\b)?';
  // '6 3/4" tall x 7 5/8" wide' (Harmony) prints the direction words between
  var DIMW = '(?:\\s*(?:tall|wide|long|high))?';
  var DIMS2_RE = new RegExp(MEAS + UNIT + DIMW + '\\s*[x\u00d7]\\s*(?:' + MEAS + UNIT + '|(WOF|LOF|width\\s+of\\s+fabric))', 'i');
  var SQUARE_RE = new RegExp(MEAS + UNIT + '\\s*(?:squares?|sq\\b)', 'i');

  /**
   * SewQuilt.parseDims(str) -> { w, h, unit, wof } | null. w is across, h along the strip.
   * A WOF strip is h × WOF: { w: null, h, wof: true }.
   */
  function parseDims(s) {
    var t = str(s);
    var m = DIMS2_RE.exec(t);
    if (m) {
      var a = parseMeasure(m[1]);
      var unit = /cm/i.test(m[2] || m[4] || '') ? 'cm' : (/mm/i.test(m[2] || m[4] || '') ? 'mm' : 'in');
      if (m[5]) return a ? { w: null, h: a, unit: unit, wof: true } : null;
      var b = parseMeasure(m[3]);
      if (!a || !b) return null;
      if (!m[2] && !m[4] && !/\b(?:cm|mm)\b/i.test(t) && !/["\u201d]/.test(t)) unit = 'in';
      return { w: a, h: b, unit: unit, wof: false };
    }
    m = SQUARE_RE.exec(t);
    if (m) {
      var q = parseMeasure(m[1]);
      return q ? { w: q, h: q, unit: /cm/i.test(m[2] || '') ? 'cm' : 'in', wof: false } : null;
    }
    return null;
  }
  function inches(v, unit) { return unit === 'cm' ? v / 2.54 : (unit === 'mm' ? v / 25.4 : v); }

  function groupKeyOf(row, fabric) {
    var t = str(row.note) + ' ' + str(row.piece) + ' ' + str(row.line);
    var m = /\bfabric\s+([A-Z]{1,2})\b/i.exec(t);
    if (m) return { key: 'fabric:' + m[1].toUpperCase(), name: 'Fabric ' + m[1].toUpperCase(), letter: m[1].toUpperCase() };
    var mat = str(row.material) || 'main';
    var names = { main: 'Main fabric', lining: 'Lining', interfacing: 'Interfacing', contrast: 'Contrast', other: 'Other' };
    return { key: 'mat:' + mat, name: names[mat] || (mat.charAt(0).toUpperCase() + mat.slice(1)), letter: '' };
  }

  /**
   * SewQuilt.boardModel(cutting, fabric, opts) -> { groups, undrawn, width }
   * Every piece with printed dimensions is placed to scale on a `width`-inch board (42"
   * default, "one way to cut it"): WOF strips run the full width with their subcuts inside.
   */
  function boardModel(cutting, fabric, opts) {
    opts = opts || {};
    var WOF = num(opts.width, 42);
    var groups = {}, order = [], undrawn = [];
    var lastStrip = null;
    (cutting || []).forEach(function (row, ri) {
      if (!row) return;
      var g = groupKeyOf(row, fabric);
      if (!groups[g.key]) { groups[g.key] = { key: g.key, name: g.name, letter: g.letter, pieces: [], undrawn: [] }; order.push(g.key); }
      var G = groups[g.key];
      var d = parseDims(row.dims || row.piece || row.line);
      var item = { row: row, index: ri, id: row.id, qty: Math.max(1, num(row.qty, 1)), cut: Math.max(0, num(row.cutCount, 0)), dims: d, subcut: !!row.subcut };
      if (!d) { G.undrawn.push(item); undrawn.push(item); return; }
      item.wIn = d.wof ? WOF : inches(d.w, d.unit);
      item.hIn = inches(d.h, d.unit);
      if (d.wof) lastStrip = item;
      if (item.subcut && lastStrip && groups[g.key].pieces.indexOf(lastStrip) >= 0) item.parent = lastStrip;
      G.pieces.push(item);
    });
    // Shelf packing (first fit, decreasing height) across the board for loose pieces; strips
    // take a whole shelf each and hold their subcuts.
    var list = order.map(function (k) { return groups[k]; });
    list.forEach(function (G) {
      var y = 0, shelves = [];
      var strips = G.pieces.filter(function (p) { return p.dims.wof; });
      var loose = G.pieces.filter(function (p) { return !p.dims.wof && !p.parent; });
      var kids = G.pieces.filter(function (p) { return p.parent; });
      G.rects = [];
      strips.forEach(function (s) {
        for (var n = 0; n < s.qty; n++) {
          G.rects.push({ item: s, x: 0, y: y, w: WOF, h: s.hIn, n: n, cut: n < s.cut });
          // the subcuts of this strip, laid inside it
          var x = 0;
          kids.forEach(function (k) {
            if (k.parent !== s) return;
            var per = Math.max(1, Math.floor(WOF / k.wIn));
            var mine = Math.max(0, Math.min(per, k.qty - n * per));
            for (var q = 0; q < mine && x + k.wIn <= WOF + 1e-6; q++) {
              var idx = n * per + q;
              G.rects.push({ item: k, x: x, y: y, w: k.wIn, h: Math.min(k.hIn, s.hIn), n: idx, cut: idx < k.cut, sub: true });
              x += k.wIn;
            }
          });
          y += s.hIn + 0.25;
        }
      });
      loose.sort(function (a, b) { return b.hIn - a.hIn; });
      loose.forEach(function (p) {
        for (var n = 0; n < p.qty; n++) {
          var w = Math.min(p.wIn, WOF), h = p.hIn;
          if (p.wIn > WOF && p.hIn <= WOF) { w = p.hIn; h = p.wIn; }   // turn it to fit
          var placed = false;
          for (var s = 0; s < shelves.length && !placed; s++) {
            if (shelves[s].x + w <= WOF + 1e-6 && h <= shelves[s].h + 1e-6) {
              G.rects.push({ item: p, x: shelves[s].x, y: shelves[s].y, w: w, h: h, n: n, cut: n < p.cut });
              shelves[s].x += w + 0.25; placed = true;
            }
          }
          if (!placed) {
            var sh = { x: w + 0.25, y: y, h: h };
            shelves.push(sh);
            G.rects.push({ item: p, x: 0, y: y, w: w, h: h, n: n, cut: n < p.cut });
            y += h + 0.25;
          }
        }
      });
      G.height = y;
      G.drawn = G.rects.length > 0;
    });
    return { groups: list, undrawn: undrawn, width: WOF };
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    return e;
  }

  /**
   * SewQuilt.mountBoard(el, cutting, { fabric, onTap(row), swatchColours:{letter: '#hex'}, width })
   * -> { update(cutting), destroy() }
   */
  function mountBoard(el, cutting, opts) {
    opts = opts || {};
    var root = document.createElement('div');
    root.className = 'sew-board';
    el.appendChild(root);
    function render(cut) {
      while (root.firstChild) root.removeChild(root.firstChild);
      var bm = boardModel(cut, opts.fabric, opts);
      bm.groups.forEach(function (G) {
        var sec = document.createElement('section');
        var h = document.createElement('h4');
        var cutN = 0, allN = 0;
        G.pieces.concat(G.undrawn).forEach(function (it) { if (!it.parent || true) { allN += it.qty; cutN += Math.min(it.qty, it.cut); } });
        h.textContent = G.name + ' \u00b7 ' + cutN + ' of ' + allN + ' cut';
        sec.appendChild(h);
        if (G.drawn) {
          var W = bm.width, Hh = Math.max(1, G.height);
          var svg = svgEl('svg', { viewBox: '-0.5 -0.5 ' + (W + 1) + ' ' + (Hh + 1), width: '100%', role: 'group',
            'aria-label': G.name + ', drawn to scale on a ' + W + ' inch width. One way to cut it.' });
          svg.style.display = 'block';
          svg.style.maxHeight = '60vh';
          var colour = (opts.swatchColours && G.letter && opts.swatchColours[G.letter]) || null;
          var bg = svgEl('rect', { x: 0, y: 0, width: W, height: Hh, style: 'fill:var(--surface-2,#eee);stroke:var(--border,#999);stroke-width:0.1' });
          svg.appendChild(bg);
          // one tap target per row (all its pieces), so a tap counts one more cut
          var byRow = {};
          G.rects.forEach(function (r) { (byRow[r.item.index] = byRow[r.item.index] || []).push(r); });
          Object.keys(byRow).forEach(function (k) {
            var rs = byRow[k], it = rs[0].item;
            var g = svgEl('g', { 'class': 'sew-board-piece' + (it.cut >= it.qty ? ' is-cut' : ''), tabindex: '0', role: 'button',
              'aria-label': it.row.piece + (it.row.dims ? ' ' + it.row.dims : '') + ': ' + Math.min(it.cut, it.qty) + ' of ' + it.qty + ' cut' });
            rs.forEach(function (r) {
              var fill = r.cut ? (colour || 'var(--primary,#36c)') : 'var(--surface,#fff)';
              g.appendChild(svgEl('rect', { x: r.x + 0.05, y: r.y + 0.05, width: Math.max(0.1, r.w - 0.1), height: Math.max(0.1, r.h - 0.1),
                style: 'fill:' + fill + ';fill-opacity:' + (r.cut ? (r.sub ? 0.9 : 0.55) : 1) + ';stroke:var(--text-muted,#666);stroke-width:' + (r.sub ? 0.06 : 0.12) + (r.cut ? '' : ';stroke-dasharray:0.4 0.25') }));
            });
            var fire = function () { if (typeof opts.onTap === 'function') opts.onTap(it.row); };
            g.addEventListener('click', fire);
            g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
            g.style.cursor = 'pointer';
            svg.appendChild(g);
          });
          sec.appendChild(svg);
          var cap = document.createElement('p');
          cap.className = 'sew-quilt-note';
          cap.textContent = 'To scale on ' + W + '" fabric. One way to cut it; the yardage is the pattern\u2019s.';
          sec.appendChild(cap);
        }
        if (G.undrawn.length) {
          var ul = document.createElement('ul');
          G.undrawn.forEach(function (it) {
            var li = document.createElement('li');
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'sew-board-piece' + (it.cut >= it.qty ? ' is-cut' : '');
            b.textContent = it.row.piece + ' \u00b7 ' + Math.min(it.cut, it.qty) + ' of ' + it.qty + ' cut';
            b.addEventListener('click', function () { if (typeof opts.onTap === 'function') opts.onTap(it.row); });
            li.appendChild(b);
            ul.appendChild(li);
          });
          sec.appendChild(ul);
        }
        root.appendChild(sec);
      });
    }
    render(cutting);
    return {
      el: root,
      update: render,
      destroy: function () { if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  /**
   * SewQuilt.loadImage(projectId, model, source, opts) -> Promise<ImageBitmap|HTMLImageElement|null>
   * The model's region of the page as a picture for mount({image}), cut once and kept in
   * BlobStore (p:<id>:fig:<page>:<hash>) through SewFigures.renderCrops. opts { signal, width: 1200 }.
   */
  function loadImage(projectId, model, source, opts) {
    opts = opts || {};
    var F = window.SewFigures;
    if (!F || !model || !model.box) return Promise.resolve(null);
    var lk = { page: model.page, rect: model.box, mode: 'quilt' };
    return F.renderCrops(projectId, [lk], source, { modes: ['quilt'], width: num(opts.width, 1200), maxPixels: 2.5e6, signal: opts.signal })
      .then(function (crops) {
        var c = crops[0];
        if (!c) return null;
        var blobP = c.blob ? Promise.resolve(c.blob) : (window.BlobStore ? window.BlobStore.get(c.blobKey) : Promise.resolve(null));
        return blobP.then(function (blob) {
          if (!blob) return null;
          if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
          return new Promise(function (resolve) {
            var im = new Image(), url = URL.createObjectURL(blob);
            im.onload = function () { URL.revokeObjectURL(url); resolve(im); };
            im.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
            im.src = url;
          });
        });
      });
  }

  window.SewQuilt = {
    loadImage: loadImage,
    fromShapes: fromShapes,
    findLayout: findLayout,
    findPicture: findPicture,
    pictureModel: pictureModel,
    progress: progress,
    mount: mount,
    mountUnit: mountUnit,
    parseDims: parseDims,
    parseMeasure: parseMeasure,
    boardModel: boardModel,
    mountBoard: mountBoard,
    unitKey: unitKey,
    labelKey: labelKey,
    _labelTokens: labelTokens,
    _inPoly: inPoly,
    _cluster: clusterBoxes
  };
})();
