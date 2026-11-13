/* Synthetic knitting Models for the 3D tests and the gallery (wave H,
   knit-3d-2). Each is built from the COUNTS in docs/research/knitting.md
   §9–§13 — cast-ons, panel widths and crossing rows, increase cadences,
   short-row turning points — never from a pattern's own wording. They stand
   in for `Knits.expand` until the parser reads these fixtures into whole
   parts. Model v2 knitting records (contract §2): {t, c, h, w, side} plus a
   cable's {cross, span, at, cf, cb, name}. ES5, one global. */
(function (global) {
  'use strict';

  function kst(t, side, h, w, extra) {
    var o = { t: t, c: null, h: h || 0.75, w: w == null ? 1 : w };
    if (side) o.side = side;
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }
  function kline(n, t, side, h, w) { var a = []; for (var i = 0; i < n; i++) a.push(kst(t, side, h, w)); return a; }
  function rib(n, k, p, side, ws) {
    var a = [];
    while (a.length < n) {
      for (var i = 0; i < k && a.length < n; i++) a.push(kst(ws ? 'p' : 'k', side, 0.75, 0.8));
      for (i = 0; i < p && a.length < n; i++) a.push(kst(ws ? 'k' : 'p', side, 0.75, 0.8));
    }
    return a;
  }
  function kr(list, opt) {
    opt = opt || {};
    var cnt = 0;
    list.forEach(function (s) { if (s.t !== 'bo') cnt++; });
    var r = { count: cnt, done: cnt, stitches: list, color: opt.color || '#c8d8f0', height: opt.h || (list[0] && list[0].h) || 0.75,
      ghost: false, inc: opt.inc || null, dec: opt.dec || null };
    if (opt.side) r.side = opt.side;
    if (opt.shortRow) r.shortRow = true;
    return r;
  }
  function km(rs, mode, shape) {
    rs.forEach(function (r, i) { r.row = i + 1; });
    return { mode: mode || 'rounds', craft: 'knitting', rounds: rs, current: rs.length - 1, defaultColor: '#c8d8f0',
      shape: shape || { start: 'unknown' }, window: { first: 1, total: rs.length }, deviation: { expected: null, actual: 0 } };
  }

  /* ---- cables -------------------------------------------------------------
     A crossing as the pattern defines it (research §9–§12 tables): `n`
     stitches, `cross` f|b, `cf` knit stitches in the front group, `cb` knit
     stitches left in the back group; `res` = the knit mask the crossing
     leaves (physical order, as the renderer lays a RS row), which is what the
     WS row after it faces. */
  var CABLES = {
    // Patons mock neck (§9) and cabled yoke (§12)
    C4F: { n: 4, cross: 'f', cf: 2, cb: 2, res: [1, 1, 1, 1] },
    C4B: { n: 4, cross: 'b', cf: 2, cb: 2, res: [1, 1, 1, 1] },
    C6F: { n: 6, cross: 'f', cf: 3, cb: 3, res: [1, 1, 1, 1, 1, 1] },
    C6B: { n: 6, cross: 'b', cf: 3, cb: 3, res: [1, 1, 1, 1, 1, 1] },
    T3F: { n: 3, cross: 'f', cf: 2, cb: 0, res: [1, 1, 0] },      // 2 knits travel left over a purl
    T3B: { n: 3, cross: 'b', cf: 2, cb: 0, res: [0, 1, 1] },      // ...or right
    T4F: { n: 4, cross: 'f', cf: 2, cb: 0, res: [1, 1, 0, 0] },
    T4B: { n: 4, cross: 'b', cf: 2, cb: 0, res: [0, 0, 1, 1] },
    TW4R: { n: 4, cross: 'b', cf: 2, cb: 1, res: [1, 0, 1, 1] },
    TW4L: { n: 4, cross: 'f', cf: 2, cb: 1, res: [1, 1, 0, 1] },
    // boyfriend (§10): its T3F is ONE twisted stitch over a K1tbl and a P1
    BF_T3F: { name: 'T3F', n: 3, cross: 'f', cf: 1, cb: 1, res: [1, 0, 1] },
    T2F: { n: 2, cross: 'f', cf: 1, cb: 0, res: [1, 0] },
    T2B: { n: 2, cross: 'b', cf: 1, cb: 0, res: [0, 1] },
    CR4F: { n: 4, cross: 'f', cf: 1, cb: 3, res: [1, 1, 1, 1] },
    CR4B: { n: 4, cross: 'b', cf: 1, cb: 3, res: [1, 1, 1, 1] },
    // boxy (§11)
    C3BK: { n: 3, cross: 'b', cf: 2, cb: 1, res: [1, 1, 1] },
    C3FK: { n: 3, cross: 'f', cf: 2, cb: 1, res: [1, 1, 1] },
    C3BP: { n: 3, cross: 'b', cf: 2, cb: 0, res: [0, 1, 1] },
    C3FP: { n: 3, cross: 'f', cf: 2, cb: 0, res: [1, 1, 0] },
    CR5B: { n: 5, cross: 'b', cf: 2, cb: 3, res: [1, 1, 1, 1, 1] },
    CR7B: { n: 7, cross: 'b', cf: 3, cb: 3, res: [1, 1, 1, 0, 1, 1, 1] },
    CR7F: { n: 7, cross: 'f', cf: 3, cb: 3, res: [1, 1, 1, 0, 1, 1, 1] }
  };

  /* A row spec is a list of tokens: 'k3', 'p2', or a cable key. */
  function tokWidth(t) {
    var c = CABLES[t];
    if (c) return c.n;
    return +String(t).slice(1);
  }
  function specWidth(spec) { return spec.reduce(function (s, t) { return s + tokWidth(t); }, 0); }
  /** RS records (physical order = work order on a RS row) and the mask the row leaves. */
  function rsRow(spec, side) {
    var recs = [], mask = [];
    spec.forEach(function (t) {
      var c = CABLES[t];
      if (c) {
        for (var q = 0; q < c.n; q++) {
          recs.push(kst('cable', side, 0.75, 0.85, { cross: c.cross, span: c.n, at: q, cf: c.cf, cb: c.cb, name: c.name || t }));
          mask.push(c.res[q]);
        }
        return;
      }
      var k = t.charAt(0) === 'k', n = +t.slice(1);
      for (var i = 0; i < n; i++) { recs.push(kst(k ? 'k' : 'p', side)); mask.push(k ? 1 : 0); }
    });
    return { recs: recs, mask: mask };
  }
  /** The WS row over a mask: work order runs right to left, knits faced as purls. */
  function wsRow(mask) {
    var recs = [];
    for (var i = mask.length - 1; i >= 0; i--) recs.push(kst(mask[i] ? 'p' : 'k', 'ws'));
    return recs;
  }

  /* Panel definitions: the RS rows (odd 1..R), from the research crossing
     tables. Rows not listed repeat the plain columns of the row before. */
  var PANEL_C = {   // §9 Panel Pat C: 9 sts, 12 rows, C6F on 3, C6B on 9
    w: 9, rows: 12,
    rs: { 1: ['k9'], 3: ['C6F', 'k3'], 5: ['k9'], 7: ['k9'], 9: ['k3', 'C6B'], 11: ['k9'] }
  };
  var PANEL_B = {   // §9 Panel Pat B: 17 sts, 28 rows
    w: 17, rows: 28,
    rs: {
      1: ['p4', 'TW4R', 'p1', 'TW4L', 'p4'],
      3: ['p3', 'T3B', 'p5', 'T3F', 'p3'], 5: ['p2', 'T3B', 'p7', 'T3F', 'p2'],
      7: ['p1', 'T3B', 'p9', 'T3F', 'p1'], 9: ['T3B', 'p11', 'T3F'],
      11: ['T3F', 'p11', 'T3B'], 13: ['p1', 'T3F', 'p9', 'T3B', 'p1'],
      15: ['p2', 'T3F', 'p7', 'T3B', 'p2'], 17: ['p3', 'T3F', 'p5', 'T3B', 'p3'],
      19: ['p4', 'C4F', 'p1', 'C4B', 'p4'], 21: ['p4', 'C4B', 'p1', 'C4F', 'p4'],
      23: ['p4', 'k4', 'p1', 'k4', 'p4'], 25: ['p4', 'C4B', 'p1', 'C4F', 'p4'], 27: ['p4', 'k4', 'p1', 'k4', 'p4']
    }
  };
  var PANEL_A = {   // §9 Panel Pat A: 24 sts, 24 rows, every RS row crosses; C4 on 3, 9, 15, 21
    w: 24, rows: 24,
    rs: {
      1: ['p1', 'T3F', 'T3B', 'p2', 'T3F', 'T3B', 'p2', 'T3F', 'T3B', 'p1'],
      3: ['p2', 'C4F', 'p4', 'C4F', 'p4', 'C4F', 'p2'],
      5: ['p1', 'T3B', 'T3F', 'p2', 'T3B', 'T3F', 'p2', 'T3B', 'T3F', 'p1'],
      13: ['T3B', 'p2', 'T3F', 'T3B', 'p2', 'T3F', 'T3B', 'p2', 'T3F'],
      15: ['k2', 'p4', 'C4B', 'p4', 'C4B', 'p4', 'k2'],
      17: ['k2', 'p3', 'T3B', 'T3F', 'p2', 'T3B', 'T3F', 'p3', 'k2'],
      19: ['k2', 'p3', 'T3F', 'T3B', 'p2', 'T3F', 'T3B', 'p3', 'k2'],
      23: ['T3F', 'T3B', 'p2', 'T3F', 'T3B', 'p2', 'T3F', 'T3B', 'p2']
    }
  };
  PANEL_A.rs[7] = PANEL_A.rs[1]; PANEL_A.rs[9] = PANEL_A.rs[3]; PANEL_A.rs[11] = PANEL_A.rs[5]; PANEL_A.rs[21] = PANEL_A.rs[15];
  /** RS spec of a panel's row r (1-based; even rows have none). */
  function panelRs(P, r) {
    var rr = ((r - 1) % P.rows) + 1;
    if (rr % 2 === 0) return null;
    for (var q = rr; q >= 1; q -= 2) if (P.rs[q]) return P.rs[q];
    return ['k' + P.w];
  }

  /**
   * Patons Cable Knit Mock Neck Pullover, Back, size XS/S (§9): CO 130 in
   * (K2. P2) rib for 2" ending on a RS row, a WS inc row to 144, then the
   * panels C·B·C·A·C·B·C between (K3. P2) rib and the edges, to 15½" from the
   * start; armholes −4 −4 → 136; even 9½"; shoulders cast off 15 ×4 and 16 ×2.
   * Gauge 26 rows = 4". Panel rows are counted from the set-up row 1.
   */
  function mockneckBack(opts) {
    opts = opts || {};
    var rs = [], i, sd;
    var ribRows = 13;                     // 2" ≈ 13 rows, ending on a RS row
    for (i = 0; i < ribRows; i++) {
      sd = i % 2 ? 'ws' : 'rs';
      rs.push(kr(rib(130, 2, 2, sd, sd === 'ws'), { side: sd }));
    }
    // inc row (WS): M1 ×14 → 144
    var inc = [], q = 0;
    for (i = 0; i < 130; i++) { inc.push(kst(i % 4 < 2 ? 'k' : 'p', 'ws', 0.75, 0.8)); if (i % 9 === 8 && q < 14) { inc.push(kst('m1', 'ws')); q++; } }
    while (q < 14) { inc.push(kst('m1', 'ws')); q++; }
    rs.push(kr(inc, { side: 'ws' }));
    function layout(r) {
      var C = panelRs(PANEL_C, r), B = panelRs(PANEL_B, r), A = panelRs(PANEL_A, r);
      var half = [].concat(C, ['p2', 'k3', 'p2'], B, ['p2', 'k3', 'p2'], C, ['p2']);
      return [].concat(['k2', 'p2'], half, ['k3', 'p2'], A, ['p2', 'k3', 'p2'], half, ['k2']);
    }
    var patRows = opts.rows || 86;        // to 15½" (≈ 100 rows from the cast-on)
    var lastMask = null, row, spec;
    for (row = 1; row <= patRows; row++) {
      if (row % 2) {
        spec = layout(row);
        var o = rsRow(spec, 'rs');
        lastMask = o.mask;
        rs.push(kr(o.recs, { side: 'rs' }));
      } else {
        rs.push(kr(wsRow(lastMask), { side: 'ws' }));
      }
    }
    return km(rs, 'rows');
  }
  /** The mock neck's layout on one row, for the tests: [{name, c0, w}]. */
  function mockneckPanels() {
    var at = 0, out = [];
    function add(name, w) { if (name) out.push({ name: name, c0: at, w: w }); at += w; }
    function half() { add('C', 9); add(null, 7); add('B', 17); add(null, 7); add('C', 9); add(null, 2); }
    add(null, 4); half(); add(null, 5); add('A', 24); add(null, 7); half(); add(null, 2);
    return { panels: out, width: at };
  }

  /* ---- one-cable swatches, for the per-type checks ------------------------- */
  /** A swatch of `rows` rows: p2, the cable's columns, p2; the cable crosses
      on row `at` (0-based, even = RS) every `every` rows. */
  function cableSwatch(key, rows, at, every) {
    var c = CABLES[key], rs = [], i, mask = c.res.slice();
    for (i = 0; i < rows; i++) {
      var crossHere = i >= at && (i - at) % (every || 1e9) === 0;
      if (i % 2 === 0) {
        var spec = ['p2'].concat(crossHere ? [key] : maskSpec(mask), ['p2']);
        var o = rsRow(spec, 'rs');
        rs.push(kr(o.recs, { side: 'rs' }));
      } else {
        rs.push(kr(wsRow([0, 0].concat(mask, [0, 0])), { side: 'ws' }));
      }
    }
    return km(rs, 'rows');
  }
  /** Several cables side by side on reverse stockinette (p3 between), each
      crossing on row 2 and every `every` rows after. */
  function multiSwatch(keys, rows, every) {
    var rs = [], masks = keys.map(function (k) { return CABLES[k].res.slice(); }), i;
    for (i = 0; i < rows; i++) {
      var cross = i >= 2 && (i - 2) % every === 0;
      if (i % 2 === 0) {
        var spec = ['p3'];
        keys.forEach(function (k, q) { spec = spec.concat(cross ? [k] : maskSpec(masks[q]), ['p3']); });
        rs.push(kr(rsRow(spec, 'rs').recs, { side: 'rs' }));
      } else {
        var mk = [0, 0, 0];
        keys.forEach(function (k, q) { mk = mk.concat(masks[q], [0, 0, 0]); });
        rs.push(kr(wsRow(mk), { side: 'ws' }));
      }
    }
    return km(rs, 'rows');
  }
  function maskSpec(mask) {
    var out = [], i = 0;
    while (i < mask.length) {
      var j = i;
      while (j < mask.length && mask[j] === mask[i]) j++;
      out.push((mask[i] ? 'k' : 'p') + (j - i));
      i = j;
    }
    return out;
  }

  /* ---- rounds: the cabled yoke (§12) and the Sandnes raglan (§13) ------- */

  /**
   * Patons Cabled Yoke, Bottom Yoke, size XS/S: picked up 216 around the
   * band's lower edge and worked DOWN: rnd 1 knit, rnd 2 +8 (224), rnds 3–4
   * (+8 on 4) ×3 (248), a +4 / +8 pair (260), +8 ×3 (284), then the dividing
   * round to 184 — the last round of the part (Body is its own section).
   */
  function cabledBottomYoke() {
    var counts = [216, 224], c = 224, i;
    for (i = 0; i < 3; i++) { counts.push(c); c += 8; counts.push(c); }
    c += 4; counts.push(c); c += 8; counts.push(c);
    for (i = 0; i < 3; i++) { c += 8; counts.push(c); }
    counts.push(184);
    return km(counts.map(function (n) { return kr(kline(n, 'k')); }), 'rounds');
  }
  /**
   * Patons Cabled Yoke, Top Yoke, size XS/S: picked up 198 around the band's
   * TOP edge and worked UP: a P2tog in every other repeat each even round
   * (198 → 189 → … → 90 by rnd 24) with C4B on rnds 4, 9, 14, 19, 24 at every
   * cable column, then the funnel collar (`*P1. K4.`, C4B every 5th round)
   * for 3" (≈ 20 rounds). `upsideDown` is what the store reads off "pick up
   * … around top edge" (knit-3d-2).
   */
  function cabledTopYoke() {
    var rs = [], c = 198, i, rnd;
    var reps = 18;     // 198 = 18 × 11 (P7. K4) → 90 = 18 × 5 (P1. K4)
    for (rnd = 1; rnd <= 44; rnd++) {
      if (rnd <= 24 && rnd % 2 === 0) c -= 9;     // one P2tog per 2 repeats every other round
      if (c < 90) c = 90;
      var cross = (rnd - 4) % 5 === 0 && rnd >= 4;
      var per = Math.floor(c / reps), recs = [];
      for (var r = 0; r < reps; r++) {
        var pur = per - 4;
        for (i = 0; i < pur; i++) recs.push(kst('p'));
        for (i = 0; i < 4; i++) recs.push(cross ? kst('cable', null, 0.75, 0.85, { cross: 'b', span: 4, at: i, cf: 2, cb: 2, name: 'C4B' }) : kst('k'));
      }
      while (recs.length < c) recs.splice(0, 0, kst('p'));
      rs.push(kr(recs));
    }
    return km(rs, 'rounds', { start: 'unknown', upsideDown: true, upsideDownSource: 'text' });
  }

  /**
   * Sandnes raglan no. 133 (§13), worked from the neck down in the round:
   * k1 p1 neck rib, one increase round, 6 German short rows across the back
   * neck (BOR = middle back; turning points ±t0, ±t0+s, ±t0+2s), 4 raglan
   * stitches with +8 on alternate rounds `incs` times in all, and the
   * dividing round (sleeves to spare needles, underarm cast-on) as the last
   * round of the YOKE section. children 2 yrs: 48 → 56, ±5/7/9, ×11 → 144 →
   * 92; ladies S: 64 → 80, ±9/12/15, ×17 → 216 → 132. No row gauge is
   * printed: the 7 / 9 cm rib is drawn at 26 rounds = 10 cm.
   */
  function sandnesYoke(group) {
    var g = group === 'ladies'
      ? { co: 64, ribCm: 9, inc: 80, t0: 9, step: 3, incs: 17, body: 132 }
      : { co: 48, ribCm: 7, inc: 56, t0: 5, step: 2, incs: 11, body: 92 };
    var rs = [], i, c;
    var ribRnds = Math.round(g.ribCm * 2.6);
    for (i = 0; i < ribRnds; i++) rs.push(kr(rib(g.co, 1, 1, null)));
    rs.push(kr(kline(g.inc, 'k')));
    /* short row k: a RS row from the last turn on the left to t0 + (k/2)·step
       on the right and back — row widths t0, 2·t0 − 1, then 2 + step more
       each, the turning stitch held as a double stitch */
    var right = g.t0, left = 0, w;
    for (i = 0; i < 6; i++) {
      var sd = i % 2 ? 'ws' : 'rs';
      if (i === 0) w = g.t0;
      else if (sd === 'ws') { left = g.t0 - 1 + Math.floor(i / 2) * g.step; w = right + left; }
      else { right = g.t0 + Math.floor(i / 2) * g.step; w = left + right; }
      rs.push(kr(kline(w, sd === 'ws' ? 'p' : 'k', sd), { side: sd, shortRow: true }));
    }
    c = g.inc;
    rs.push(kr(kline(c, 'k')));            // "work loops tog on next row"
    for (i = 0; i < g.incs; i++) {
      c += 8;
      rs.push(kr(kline(c, 'k')));
      if (i < g.incs - 1) rs.push(kr(kline(c, 'k')));
    }
    rs.push(kr(kline(g.body, 'k')));       // the dividing round
    var m = km(rs, 'rounds');
    m.group = g;
    return m;
  }

  /* ---- wave K (knit-3d): socks, a stranded band, a set-in sweater --------
     The Speed Bump sock, size S (research §2b): CO 56, rib, leg, a 32-row
     flap on 28, 10 short rows to 18, pick up to 80, gussets back to 56, foot,
     a toe to 20, Kitchener. `split` gives it as the sections a sock pattern
     imports as (Cuff / Leg / Heel Flap / Turn Heel / Gusset / Foot / Toe). */
  function side(i) { return i % 2 ? 'ws' : 'rs'; }
  function sockSections() {
    var S = [], rs, i, c;
    rs = []; for (i = 0; i < 16; i++) rs.push(kr(rib(56, 1, 1))); S.push({ name: 'Cuff', rounds: rs });
    rs = []; for (i = 0; i < 50; i++) rs.push(kr(kline(56, 'k'))); S.push({ name: 'Leg', rounds: rs });
    rs = []; for (i = 0; i < 32; i++) rs.push(kr(kline(28, i % 2 ? 'p' : 'k', side(i)), { side: side(i) }));
    S.push({ name: 'Heel Flap', rounds: rs, mode: 'rows' });
    rs = []; c = 27;
    for (i = 0; i < 10; i++) { rs.push(kr(kline(c, i % 2 ? 'p' : 'k', side(i)), { side: side(i), shortRow: true })); c--; }
    S.push({ name: 'Turn Heel', rounds: rs, mode: 'rows' });
    rs = []; c = 80; for (i = 0; i < 24; i++) { if (i % 2 === 0) c -= 2; rs.push(kr(kline(c, 'k'))); } S.push({ name: 'Gusset', rounds: rs });
    rs = []; for (i = 0; i < 40; i++) rs.push(kr(kline(56, 'k'))); S.push({ name: 'Foot', rounds: rs });
    rs = []; c = 56; for (i = 0; i < 17; i++) { if (i % 2 === 0) c -= 2; rs.push(kr(kline(c, 'k'))); } S.push({ name: 'Toe', rounds: rs });
    return S;
  }
  function sockTopDown() {
    var rs = [];
    sockSections().forEach(function (s) { rs = rs.concat(s.rounds); });
    return km(rs, 'rounds', { start: 'unknown', graft: true });
  }
  /* A made-up 8-stitch, 9-row peerie band (not from any pattern), as the key
     labels KnitChart gives: MC, CC1, CC2; '?' is a cell the reader left
     unread. Knitting order, bottom row first. */
  var PEERIE = [
    'MMMMMMMM', 'MMM1MMMM', 'MM111MMM', 'M11211MM', '1122211M', 'M11211MM', 'MM111MMM', 'MMM1MMMM', 'MMMMMMMM'
  ];
  var PEERIE_PAL = { MC: '#efe6d2', CC1: '#9c2f2a', CC2: '#2b5a8a' };
  function peerieCells(r, unread) {
    var row = PEERIE[r % PEERIE.length], out = [];
    for (var i = 0; i < row.length; i++) {
      var ch = row.charAt(i);
      if (unread && r === 4 && i === 7) { out.push({ sym: '?1', unknown: true, produces: 1, consumes: 1, text: '?' }); continue; }
      out.push({ sym: ch, stitch: 'k', run: 'k', text: 'k', color: ch === 'M' ? 'MC' : 'CC' + ch, produces: 1, consumes: 1 });
    }
    return out;
  }
  /* The sock with the peerie band worked on leg rounds 20–28 (one cell unread). */
  function strandedSock(unread) {
    var m = sockTopDown(), G = global.DiagramGeo;
    for (var r = 0; r < PEERIE.length; r++) {
      var i = 20 + r;
      m.rounds[i] = G.applyChart(m.rounds[i], peerieCells(r, unread), { palette: PEERIE_PAL, main: PEERIE_PAL.MC });
      m.rounds[i].row = i + 1;
    }
    m.defaultColor = PEERIE_PAL.MC;
    m.rounds.forEach(function (rd) { rd.color = PEERIE_PAL.MC; });
    return m;
  }

  /* A plain set-in-sleeve pullover, synthetic (no pattern's numbers): Back
     and Front CO 100, 10 rows k2 p2 rib, 80 rows stockinette, armhole: BO 5
     at the start of the next 2 rows, then dec 1 each end every RS row 5
     times (80), 40 rows more, BO. Sleeve CO 50, 10 rows rib, inc 1 each end
     every 6th row 12 times (74), cap: BO 5 at the start of 2 rows, dec 1
     each end every RS row to 30, BO. Neckband: 6 rounds k2 p2 on 84, worked
     up from the neck. `states` = { back, front, sleeve, neckband }. */
  function flatPiece(rows) {
    var rs = [];
    rows.forEach(function (o, i) {
      var sd = side(i), list = o.rib ? rib(o.n, 2, 2, sd, sd === 'ws') : kline(o.n, sd === 'ws' ? 'p' : 'k', sd);
      rs.push(kr(list, { side: sd }));
    });
    return km(rs, 'rows');
  }
  function bodyRows() {
    var r = [], i, n = 100;
    for (i = 0; i < 10; i++) r.push({ n: n, rib: true });
    for (i = 0; i < 80; i++) r.push({ n: n });
    n -= 5; r.push({ n: n }); n -= 5; r.push({ n: n });
    for (i = 0; i < 10; i++) { if (i % 2 === 0) n -= 2; r.push({ n: n }); }
    for (i = 0; i < 40; i++) r.push({ n: n });
    return r;
  }
  function sleeveRows() {
    var r = [], i, n = 50;
    for (i = 0; i < 10; i++) r.push({ n: n, rib: true });
    for (i = 0; i < 72; i++) { if (i % 6 === 5) n += 2; r.push({ n: n }); }
    n -= 5; r.push({ n: n }); n -= 5; r.push({ n: n });
    while (n > 30) { r.push({ n: n }); n -= 2; r.push({ n: n }); }
    return r;
  }
  function sweaterParts(states) {
    var s = states || {};
    var nb = []; for (var i = 0; i < 6; i++) nb.push(kr(rib(84, 2, 2)));
    return [
      { id: 'sw-back', name: 'Back', makeCount: 1, state: s.back || 'done', model: flatPiece(bodyRows()) },
      { id: 'sw-front', name: 'Front', makeCount: 1, state: s.front || 'done', model: flatPiece(bodyRows()) },
      { id: 'sw-sleeve', name: 'Sleeves (make 2)', makeCount: 2, state: s.sleeve || 'working', model: flatPiece(sleeveRows()) },
      { id: 'sw-neck', name: 'Neckband', makeCount: 1, state: s.neckband || 'todo', model: km(nb, 'rounds') }
    ];
  }
  /* The sock as parts, with states: sections before `working` done, after it to do. */
  function sockParts(working, at) {
    var S = sockSections(), w = working == null ? 5 : working;
    return S.map(function (s, k) {
      var m = km(s.rounds, s.mode || 'rounds', k === S.length - 1 ? { start: 'unknown', graft: true } : { start: 'unknown' });
      if (k === w) {
        m.current = at == null ? Math.floor(s.rounds.length / 2) : at;
        for (var i = m.current + 1; i < m.rounds.length; i++) { m.rounds[i].ghost = true; m.rounds[i].done = 0; }
        m.rounds[m.current].done = Math.floor(m.rounds[m.current].count / 3);
      }
      return { id: 'sock-' + k, name: s.name, makeCount: 1, state: k < w ? 'done' : k === w ? 'working' : 'todo', model: m };
    });
  }

  global.KnitSynth = {
    sweaterParts: sweaterParts, sockParts: sockParts, flatPiece: flatPiece,
    side: side, sockSections: sockSections, sockTopDown: sockTopDown,
    PEERIE: PEERIE, PEERIE_PAL: PEERIE_PAL, peerieCells: peerieCells, strandedSock: strandedSock,
    kst: kst, kline: kline, rib: rib, kr: kr, km: km,
    CABLES: CABLES, rsRow: rsRow, wsRow: wsRow, specWidth: specWidth,
    PANEL_A: PANEL_A, PANEL_B: PANEL_B, PANEL_C: PANEL_C, panelRs: panelRs,
    mockneckBack: mockneckBack, mockneckPanels: mockneckPanels, cableSwatch: cableSwatch, multiSwatch: multiSwatch,
    cabledBottomYoke: cabledBottomYoke, cabledTopYoke: cabledTopYoke, sandnesYoke: sandnesYoke
  };
}(typeof window !== 'undefined' ? window : this));
