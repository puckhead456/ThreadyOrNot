/* Thready or Not — js/app-sewing-extras.js
 * window.SewingExtras : the self-contained sewing sheets that open from a sewing
 * project's "⋯" menu (wave K, sew-extras). Contract: docs/wave-k/api/sew-extras.md.
 *
 *   SewingExtras.menuItems(project) -> [{ id, label, icon, hint }]
 *   SewingExtras.open(id, project, opts) -> boolean
 *
 * The pure logic lives in js/sewing.js (window.Sewing); the drawings in
 * js/sew-quilt.js / js/sew-figures.js. This file only builds sheets on top of
 * them, writes through Store.updateCraftData (one undo step per action), and
 * feature-detects every engine function: a missing one means the item is not
 * listed. No network, nothing heavy on the main thread.
 *
 * Sections:
 *   1. helpers (DOM, data, units, the "≈ worked out by the app" mark)
 *   2. the sheet frame (shell openSheet, or our own <dialog> in a test page)
 *   3. P6 / S5 / P7  cutting board
 *   4. P11 / S2      quilt top
 *   5. P8 / P9       quilt calculators
 *   6. P13           fabric calculator and shopping list
 *   7. P12 / S1      fabric colours
 *   8. P16           press / fuse timer, glossary
 *   9. P17           fitting log
 *  10. menu and the public object
 */
(function () {
  'use strict';

  var VERSION = 1;

  /* ================================================================== *
   * 1. Helpers
   * ================================================================== */

  function Sw() { return window.Sewing || null; }
  function St() { return window.Store || null; }
  function app() { return window.SewingApp || null; }

  /** has('quilt.binding') → Sewing.quilt.binding is a function */
  function has(path, root) {
    var o = root || Sw();
    if (!o) return false;
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (o == null) return false;
      o = o[parts[i]];
    }
    return typeof o === 'function';
  }
  function hasQ(name) { return has(name, window.SewQuilt || null); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function btn(cls, text, label) {
    var b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  function on(n, t, f) { if (n) n.addEventListener(t, f); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function plural(n, w, pl) { return n + ' ' + (n === 1 ? w : (pl || w + 's')); }
  var autoId = 0;
  function field(label, control, hint) {
    var w = el('div', 'field');
    var lab = el('label', null, label);
    if (!control.id) control.id = 'swx-f' + (++autoId);
    lab.setAttribute('for', control.id);
    w.appendChild(lab);
    w.appendChild(control);
    if (hint) w.appendChild(el('div', 'field-hint', hint));
    return w;
  }
  function input(type, value, placeholder) {
    var i = document.createElement('input');
    i.type = type;
    if (type === 'number') i.inputMode = 'decimal';
    i.value = value == null ? '' : String(value);
    if (placeholder) i.placeholder = placeholder;
    return i;
  }
  function seg(options, current, onPick, label) {
    var w = el('div', 'seg swx-seg');
    w.setAttribute('role', 'group');
    if (label) w.setAttribute('aria-label', label);
    options.forEach(function (o) {
      var b = btn(o.id === current ? 'on' : null, o.label);
      b.setAttribute('aria-pressed', o.id === current ? 'true' : 'false');
      b.setAttribute('data-focus-key', 'seg-' + (label || '') + '-' + o.id);
      on(b, 'click', function () { if (o.id !== current) onPick(o.id); });
      w.appendChild(b);
    });
    return w;
  }
  function switchRow(label, sub, checked, onToggle) {
    var row = el('div', 'toggle-row swx-toggle');
    var left = el('div');
    left.appendChild(el('div', 'toggle-label', label));
    if (sub) left.appendChild(el('div', 'toggle-sub', sub));
    var s = btn('switch');
    s.setAttribute('role', 'switch');
    s.setAttribute('aria-checked', checked ? 'true' : 'false');
    s.setAttribute('aria-label', label);
    s.setAttribute('data-focus-key', 'switch-' + label);
    on(s, 'click', function () { onToggle(s.getAttribute('aria-checked') !== 'true'); });
    row.appendChild(left);
    row.appendChild(s);
    return row;
  }

  /** A number the app worked out: "≈ 310"", read aloud as "about … (worked out by the app)". */
  function approx(text, why) {
    var t = String(text).replace(/^\s*≈\s*/, '');
    var s = el('span', 'swx-approx', '≈ ' + t);
    s.setAttribute('aria-label', 'about ' + t + ', worked out by the app');
    if (why) s.title = why;
    return s;
  }
  function byApp(why) {
    return el('p', 'swx-why', '≈ worked out by the app' + (why ? ': ' + why : ''));
  }

  var ctxNow = null;
  function ctx() { return ctxNow || (window.App && window.App.ctx) || null; }
  function toast(msg) {
    var c = ctx();
    if (c && c.toast) { try { c.toast(msg); return; } catch (e) { /* fall through */ } }
    announce(msg);
  }
  var liveNode = null;
  function announce(msg) {
    var c = ctx();
    if (c && c.announce) { try { c.announce(msg); return; } catch (e) { /* fall through */ } }
    if (!liveNode) {
      liveNode = el('div', 'swx-live');
      liveNode.setAttribute('aria-live', 'polite');
      liveNode.setAttribute('role', 'status');
      document.body.appendChild(liveNode);
    }
    liveNode.textContent = '';
    window.setTimeout(function () { liveNode.textContent = msg; }, 30);
  }
  function fb(kind) {
    var c = ctx();
    if (c && c.fb) { try { c.fb(kind); } catch (e) { /* ignore */ } }
  }

  // ---- data -----------------------------------------------------------

  function projOf(p) {
    var S = St();
    if (!S) return null;
    if (typeof p === 'string') return S.project(p) || null;
    if (p && p.id) return S.project(p.id) || p;
    return null;
  }
  function dataOf(p) {
    var A = app();
    if (A && typeof A.dataOf === 'function') {
      try { var r = A.dataOf(p); if (r) return r; } catch (e) { /* fall back */ }
    }
    return Sw().normalize(p && p.craftData, p);
  }
  function chosenSize(p, d) {
    var A = app();
    if (A && typeof A.chosenSize === 'function') {
      try { var s = A.chosenSize(p); if (s) return s; } catch (e) { /* fall back */ }
    }
    return (d && d.size && d.size.chosen) || '';
  }
  function currentStep(p, d) {
    var A = app();
    if (A && typeof A.currentStep === 'function') {
      try { var s = A.currentStep(p); if (typeof s === 'number') return s; } catch (e) { /* fall back */ }
    }
    return d ? d.currentStep | 0 : 0;
  }

  function emit(projectId, id, what) {
    try {
      var ev;
      var detail = { projectId: projectId, id: id, what: what };
      if (typeof window.CustomEvent === 'function') ev = new CustomEvent('sewingextras:change', { detail: detail });
      else { ev = document.createEvent('CustomEvent'); ev.initCustomEvent('sewingextras:change', false, false, detail); }
      document.dispatchEvent(ev);
    } catch (e) { /* ignore */ }
  }
  function repaint(projectId) {
    var A = app();
    if (A && typeof A.repaint === 'function') { try { A.repaint(projectId); return; } catch (e) { /* fall back */ } }
    var c = ctx();
    if (c && typeof c.render === 'function') { try { c.render(); return; } catch (e) { /* ignore */ } }
  }

  /** The one door this module writes through: normalise, mutate, one undo step. */
  function edit(projectId, fn, item, what) {
    var S = St();
    var res = S.updateCraftData(projectId, function (raw, proj) {
      var d = Sw().normalize(raw, proj);
      fn(d, proj);
      return d;
    });
    if (res) { repaint(projectId); emit(projectId, item, what); }
    return res;
  }

  /** craftData.fabricPrefs patch ({ key: value | null }). */
  function setPrefs(projectId, patch, item) {
    return edit(projectId, function (d) {
      var fp = d.fabricPrefs || {};
      Object.keys(patch).forEach(function (k) {
        if (patch[k] === null || patch[k] === undefined || patch[k] === '') delete fp[k];
        else fp[k] = patch[k];
      });
      d.fabricPrefs = fp;
    }, item, 'prefs');
  }

  // ---- units ----------------------------------------------------------

  /** The pattern's own system: 'imperial' | 'metric'. */
  function patternSystem(d) {
    if (d.kind === 'quilt') return 'imperial';
    var u = d.size && d.size.unit;
    if (u === 'in' || u === 'inch') return 'imperial';
    if (u === 'cm' || u === 'mm') return 'metric';
    var t = (d.fabric || []).map(function (f) { return (f.amounts || []).join(' ') + ' ' + (f.width || ''); }).join(' ');
    var imp = /\byds?\b|\byards?\b|"|”|\binch/i.test(t), met = /\bcm\b|\d\s?m\b|metre|meter/i.test(t);
    if (imp && !met) return 'imperial';
    if (met && !imp) return 'metric';
    var c = (d.cutting || []).map(function (r) { return r.piece + ' ' + r.dims; }).join(' ');
    if (/"|”|\binch/i.test(c)) return 'imperial';
    if (/\d\s?cm\b|\d\s?mm\b/i.test(c)) return 'metric';
    var sa = d.seamAllowance;
    if (sa && sa.inches && !sa.mm) return 'imperial';
    return 'metric';
  }
  function systemOf(d) {
    var u = d.fabricPrefs && d.fabricPrefs.unit;
    return u === 'imperial' || u === 'metric' ? u : patternSystem(d);
  }
  var FR = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];
  /** 3.5 → '3 1/2"' (to the nearest 1/8"). */
  function inchText(v) {
    if (v == null || !isFinite(v)) return '';
    var e = Math.round(v * 8);
    var w = Math.floor(e / 8), f = e - w * 8;
    return (w ? String(w) : (f ? '' : '0')) + (f ? (w ? ' ' : '') + FR[f] : '') + '"';
  }
  /** 0.375 → '3/8 yd', 4.5 → '4 1/2 yd' (to the nearest 1/8). */
  function ydText(v) { return inchText(v).replace('"', '') + ' yd'; }
  function cmText(cm) {
    if (cm == null || !isFinite(cm)) return '';
    var r = cm >= 100 ? Math.round(cm) : Math.round(cm * 10) / 10;
    return String(r).replace('.', '.') + ' cm';
  }
  /**
   * A length in inches shown in the project's system. `computed` marks it ≈ whatever the
   * system; a printed inch figure shown in cm is ≈ too (a conversion).
   */
  function lengthNode(inches, sys, computed, why) {
    if (sys === 'metric') return approx(cmText(inches * 2.54), why || 'converted from inches');
    return computed ? approx(inchText(inches), why) : el('span', 'swx-num', inchText(inches));
  }
  function lengthPlain(inches, sys) {
    return sys === 'metric' ? '≈ ' + cmText(inches * 2.54) : inchText(inches);
  }
  /** User input → inches. Accepts '3 1/2', '3½"', '9 cm'; a bare number is in `sys`. */
  function parseLength(text, sys) {
    var t = String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
    if (!t) return null;
    var S = Sw();
    var m = has('measure') ? S.measure(t, sys === 'metric' ? 'cm' : 'in') : null;
    var r4 = function (x) { return Math.round(x * 10000) / 10000; };
    if (m && isFinite(m.mm) && m.mm > 0) return r4(m.mm / 25.4);
    var n = parseFloat(t.replace(',', '.'));
    if (!isFinite(n) || n <= 0) return null;
    return r4(sys === 'metric' ? n / 2.54 : n);
  }
  /** '6 1/2 x 12 1/2' → { w, h } in inches (each side through parseLength). */
  function parsePair(text, sys) {
    var parts = String(text || '').split(/\s*[x×]\s*/i);
    if (parts.length === 1) { var q = parseLength(parts[0], sys); return q ? { w: q, h: q } : null; }
    var a = parseLength(parts[0], sys), b = parseLength(parts[1], sys);
    return a && b ? { w: a, h: b } : null;
  }
  function inputLenValue(inches, sys) {
    if (inches == null) return '';
    if (sys === 'metric') return String(Math.round(inches * 2.54 * 10) / 10);
    return inchText(inches).replace('"', '');
  }
  function unitWord(sys) { return sys === 'metric' ? 'cm' : 'inches'; }
  function unitSwitch(projectId, d, item, after) {
    var sys = systemOf(d), own = patternSystem(d);
    var w = el('div', 'swx-units');
    w.appendChild(seg([
      { id: 'imperial', label: own === 'imperial' ? 'Inches (pattern)' : 'Inches' },
      { id: 'metric', label: own === 'metric' ? 'cm (pattern)' : 'cm' }
    ], sys, function (id) {
      setPrefs(projectId, { unit: id === own ? null : id }, item);
      if (after) after();
    }, 'Units'));
    return w;
  }

  // ---- verdicts -------------------------------------------------------

  var GLYPH = { exact: '✓', close: '≈', off: '≠', unchecked: '?', computed: '≈', unknown: '?' };
  function flag(verdict, text) {
    var v = verdict === 'computed' ? 'close' : (verdict === 'unknown' ? 'unchecked' : verdict);
    var p = el('p', 'swx-flag swx-flag-' + v);
    p.appendChild(el('span', 'swx-flag-glyph', GLYPH[v] || '?'));
    p.setAttribute('data-verdict', v);
    p.appendChild(document.createTextNode(' ' + text));
    return p;
  }
  /** Compare a worked-out length with a printed one: exact (≤ 1/2"), close (≤ 3%), off. */
  function compare(calc, printed) {
    if (!(printed > 0) || !(calc > 0)) return 'unchecked';
    var d = Math.abs(calc - printed);
    if (d <= 0.5) return 'exact';
    if (d / printed <= 0.03) return 'close';
    return 'off';
  }

  // ---- focus survives a rebuild --------------------------------------

  function keep(body, fn) {
    var a = document.activeElement, key = a && a.getAttribute ? a.getAttribute('data-focus-key') : null;
    var top = body.scrollTop;
    fn();
    body.scrollTop = top;
    if (key) {
      var list = body.querySelectorAll('[data-focus-key]');
      for (var i = 0; i < list.length; i++) {
        if (list[i].getAttribute('data-focus-key') === key) { try { list[i].focus(); } catch (e) { /* ignore */ } break; }
      }
    }
  }

  // ---- colours the sewist set (P12) -----------------------------------

  var keepsColours = null;
  function normalizeKeepsColours() {
    if (keepsColours === null) {
      try {
        var t = Sw().normalize({ swatchColours: { 0: '#112233' } }, null);
        keepsColours = !!(t && t.swatchColours && t.swatchColours[0] === '#112233');
      } catch (e) { keepsColours = false; }
    }
    return keepsColours;
  }
  function coloursOf(proj, d) {
    if (normalizeKeepsColours()) return (d && d.swatchColours) || {};
    try {
      var bag = St().craftSettings('sewing') || {};
      return (bag.extrasSwatches && bag.extrasSwatches[proj.id]) || {};
    } catch (e) { return {}; }
  }
  function setColour(projectId, index, hex) {
    var ok = /^#[0-9a-f]{6}$/i.test(hex || '');
    if (normalizeKeepsColours()) {
      edit(projectId, function (d) {
        var m = d.swatchColours || {};
        if (ok) m[index] = hex.toLowerCase(); else delete m[index];
        d.swatchColours = m;
      }, 'swatches', 'swatch');
      return;
    }
    try {
      var S = St(), bag = S.craftSettings('sewing') || {};
      var all = bag.extrasSwatches && typeof bag.extrasSwatches === 'object' ? bag.extrasSwatches : {};
      var m = all[projectId] || {};
      if (ok) m[index] = hex.toLowerCase(); else delete m[index];
      if (Object.keys(m).length) all[projectId] = m; else delete all[projectId];
      S.setCraftSetting('sewing', 'extrasSwatches', all);
    } catch (e) { /* ignore */ }
    repaint(projectId);
    emit(projectId, 'swatches', 'swatch');
  }
  function letterOf(name) {
    var m = /\bfabric\s+([A-Z]{1,2})\b/i.exec(String(name || ''));
    return m ? m[1].toUpperCase() : '';
  }
  /** Which fabric row a cutting-board group or a quilt letter means (index or -1). */
  function fabricIndexFor(d, g) {
    var f = d.fabric || [];
    var letter = g.letter || '';
    var i;
    if (letter) {
      for (i = 0; i < f.length; i++) if (letterOf(f[i].name) === letter) return i;
      return -1;
    }
    var re = g.kind === 'lining' ? /lining/i : g.kind === 'contrast' ? /contrast/i : g.kind === 'batting' ? /batting|wadding/i : null;
    if (re) { for (i = 0; i < f.length; i++) if (re.test(f[i].name)) return i; return -1; }
    if (g.kind === 'main') {
      for (i = 0; i < f.length; i++) if (!/lining|interfac|fusing|fusible|contrast|batting|backing|binding/i.test(f[i].name)) return i;
    }
    return -1;
  }
  function chipNode(hex, label) {
    var c = el('span', 'swx-chip' + (hex ? '' : ' is-unset'));
    if (hex) c.style.background = hex;
    c.setAttribute('aria-hidden', 'true');
    if (label) c.title = label;
    return c;
  }

  /* ================================================================== *
   * 2. The sheet frame
   * ================================================================== */

  var current = null;   // { api, onClose:[fn] }

  function closeMine() {
    if (current && current.api) { try { current.api.close(); } catch (e) { /* ignore */ } }
    current = null;
  }

  /**
   * openSheet(title, build(body, api), { cls }) → api { body, dialog, close }.
   * The shell's sheet when there is one; else our own <dialog> with the shell's
   * class names, focus moved in, Escape closing, focus returned.
   */
  function openSheet(title, build, o) {
    o = o || {};
    closeMine();
    var mine = { api: null, cleanups: [] };
    current = mine;
    var opener = document.activeElement;
    function cleanup() {
      mine.cleanups.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
      mine.cleanups = [];
      if (current === mine) current = null;
    }
    var c = ctx();
    var cls = 'sheet-sewing swx-sheet' + (o.cls ? ' ' + o.cls : '');
    if (c && typeof c.openSheet === 'function') {
      mine.api = c.openSheet({
        title: title, cls: cls, subject: o.subject || null,
        build: function (body, api) { mine.api = api; build(body, api, mine); },
        onClose: function () {
          cleanup();
          if (opener && opener.isConnected && typeof opener.focus === 'function') { try { opener.focus(); } catch (e) { /* ignore */ } }
        }
      });
      return mine.api;
    }
    // Our own dialog (a test page, or a shell without openSheet).
    var dlg = el('dialog', 'sheet ' + cls);
    var inner = el('div', 'sheet-inner');
    var head = el('div', 'sheet-head');
    var h = el('h2', 'sheet-title', title);
    h.id = 'swx-title-' + (++autoId);
    dlg.setAttribute('aria-labelledby', h.id);
    var x = btn('sheet-close', '✕', 'Close');
    head.appendChild(h);
    head.appendChild(x);
    var body = el('div', 'sheet-body');
    inner.appendChild(head);
    inner.appendChild(body);
    dlg.appendChild(inner);
    var closed = false;
    var api = {
      dialog: dlg, body: body, title: h,
      close: function () {
        if (closed) return;
        closed = true;
        try { if (dlg.open) dlg.close(); } catch (e) { /* ignore */ }
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
        cleanup();
        if (opener && opener.isConnected && typeof opener.focus === 'function') { try { opener.focus(); } catch (e) { /* ignore */ } }
      }
    };
    mine.api = api;
    on(x, 'click', function () { api.close(); });
    on(dlg, 'keydown', function (e) {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); api.close(); }
    });
    on(dlg, 'cancel', function (e) { e.preventDefault(); api.close(); });
    on(dlg, 'click', function (e) { if (e.target === dlg) api.close(); });
    document.body.appendChild(dlg);
    build(body, api, mine);
    try { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); } catch (e) { dlg.setAttribute('open', ''); }
    var first = body.querySelector('button, input, select, textarea, [tabindex="0"]') || x;
    try { first.focus(); } catch (e) { /* ignore */ }
    return api;
  }
  function onClosed(mine, fn) { if (mine) mine.cleanups.push(fn); }

  function head(body, text) { body.appendChild(el('p', 'muted swx-head', text)); }
  function section(body, title, cls) {
    var s = el('section', 'swx-section' + (cls ? ' ' + cls : ''));
    if (title) s.appendChild(el('h3', 'swx-h', title));
    body.appendChild(s);
    return s;
  }
  function pageText(n) { return typeof n === 'number' && n > 0 ? 'page ' + n : ''; }

  /* ================================================================== *
   * 3. P6 / S5 / P7: the cutting board, by fabric, with the interfacing map
   * ================================================================== */

  var APPLY = {
    fusible: 'Fusible: iron it on, glue side to the wrong side of the fabric.',
    'sew-in': 'Sew-in: no iron. Stitch it to the piece inside the seam allowance.'
  };
  var FROM = {
    saved: 'as you set it', 'cut line': 'named on the cut line', 'next lines': 'named on the lines beside it',
    'piece name': 'from the piece name', 'only one on the list': 'the only interfacing on the materials list'
  };
  var CUT_TAP_MAX = 6;

  function openBoard(proj, o) {
    var pid = proj.id;
    var mode = 'fabric';
    var scaleOpen = false;
    var scrolled = false;
    openSheet('Cutting board', function (body) {
      function render() {
        clear(body);
        var p = projOf(pid);
        if (!p) return;
        var d = dataOf(p), S = Sw();
        var sys = systemOf(d);
        var wof = (d.fabricPrefs && d.fabricPrefs.wof) || 40;
        var board = S.cuttingBoard(d, { wof: wof });
        var t = board.totals || S.cutTotals(d);
        var line = t.cut + ' of ' + plural(t.total, 'piece') + ' cut';
        if (t.strips) line += ' · ' + t.stripsCut + ' of ' + plural(t.strips, 'strip') + ' cut';
        head(body, d.cutting.length ? line : 'No pieces on the cutting list yet.');

        var hasDims = false, hasStrips = false;
        board.groups.forEach(function (g) { g.rows.forEach(function (r) { if (r.dims) hasDims = true; if (r.dims && r.dims.wof) hasStrips = true; }); });

        var bar = el('div', 'swx-bar');
        bar.appendChild(seg([{ id: 'fabric', label: 'By fabric' }, { id: 'piece', label: 'By piece' }], mode,
          function (id) { mode = id; keep(body, render); }, 'Group the list'));
        if (hasDims) bar.appendChild(unitSwitch(pid, d, 'board', function () { keep(body, render); }));
        body.appendChild(bar);

        if (hasStrips) {
          var w = input('text', inputLenValue(wof, sys), sys === 'metric' ? '101.6' : '40');
          w.setAttribute('data-focus-key', 'board-wof');
          w.className = 'swx-in-short';
          on(w, 'change', function () {
            var v = parseLength(w.value, sys);
            if (!v || v < 30 || v > 120) { toast('Give a width between 30" and 120" (76 to 305 cm)'); keep(body, render); return; }
            setPrefs(pid, { wof: Math.round(v * 8) / 8 }, 'board');
            keep(body, render);
          });
          body.appendChild(field('Usable width of your fabric (' + unitWord(sys) + ')', w,
            'Selvedge to selvedge, without the selvedges. Quilters often plan on 40". The strip checks use this.'));
        }

        if (board.fuse && board.fuse.length) {
          var fc = section(body, 'Fuse before you sew', 'swx-fuse');
          board.fuse.forEach(function (f) {
            var li = el('div', 'swx-fuse-item');
            li.appendChild(el('p', 'swx-quote', f.text));
            var bits = [];
            if (f.pieces && f.pieces.length) bits.push(plural(f.pieces.length, 'piece') + ': ' + f.pieces.join(', '));
            if (f.interfacing) bits.push(f.interfacing);
            if (f.page) bits.push(pageText(f.page));
            if (bits.length) li.appendChild(el('p', 'field-hint', bits.join(' · ')));
            fc.appendChild(li);
          });
        }

        var colours = coloursOf(p, d);
        if (mode === 'piece') renderByPiece(body, board);
        else board.groups.forEach(function (g) { renderGroup(body, p, d, g, sys, colours, function () { keep(body, render); }); });

        if (hasDims && hasQ('mountBoard')) {
          var det = el('details', 'swx-scale');
          det.open = scaleOpen;
          det.appendChild(el('summary', null, 'Drawn to scale'));
          det.appendChild(el('p', 'field-hint', 'One way to lay the pieces out on ' + lengthPlain(wof, sys) +
            ' fabric. The amounts to buy are the pattern’s, not this drawing’s.'));
          var holder = el('div', 'swx-scale-holder');
          det.appendChild(holder);
          var mounted = false;
          var mount = function () {
            if (mounted || !det.open) return;
            mounted = true;
            var sc = {};
            (d.fabric || []).forEach(function (f, i) { var L = letterOf(f.name); if (L && colours[i]) sc[L] = colours[i]; });
            try {
              window.SewQuilt.mountBoard(holder, d.cutting, {
                fabric: d.fabric, width: wof, swatchColours: sc,
                onTap: function (row) { var r = findRow(dataOf(projOf(pid)), row.id); if (r) setCut(pid, row.id, r.cutCount + 1, function () { keep(body, render); }); }
              });
            } catch (e) { holder.appendChild(el('p', 'muted', 'The drawing could not be made on this device.')); }
          };
          on(det, 'toggle', function () { scaleOpen = det.open; mount(); });
          body.appendChild(det);
          mount();
        }

        if (!scrolled && o && o.fabric) {
          scrolled = true;
          var want = String(o.fabric);
          var nodes = body.querySelectorAll('.swx-group');
          for (var i = 0; i < nodes.length; i++) {
            var k = nodes[i].getAttribute('data-key'), L = nodes[i].getAttribute('data-letter'), K = nodes[i].getAttribute('data-kind');
            if (k === want || (L && L === want.toUpperCase()) || (K && K === want)) {
              nodes[i].classList.add('is-target');
              if (nodes[i].scrollIntoView) { try { nodes[i].scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ } }
              break;
            }
          }
        }
      }
      render();
    }, { subject: pid });
  }

  function findRow(d, id) {
    for (var i = 0; i < d.cutting.length; i++) if (d.cutting[i].id === id) return d.cutting[i];
    return null;
  }

  function setCut(pid, rowId, value, after) {
    var p = projOf(pid);
    if (!p) return;
    var before = dataOf(p);
    var row = findRow(before, rowId);
    if (!row) return;
    var v = Math.max(0, Math.min(row.qty, value | 0));
    if (v === row.cutCount) { if (v >= row.qty) toast('All ' + row.qty + ' cut. Use − to take one off.'); return; }
    var delta = v - row.cutCount;
    var S = Sw();
    edit(pid, function (d) { var r = findRow(d, rowId); if (r) r.cutCount = v; }, 'board', 'cut');
    var St_ = St();
    if (typeof St_.counted === 'function') {
      try { St_.counted({ projectId: pid, n: delta, unit: 'cut', part: row.piece }); } catch (e) { /* ignore */ }
    }
    fb(delta < 0 ? 'undo' : 'tap');
    announce(row.piece + ', ' + v + ' of ' + row.qty + ' cut');
    if (has('milestones')) {
      try {
        var after_ = dataOf(projOf(pid));
        var m = S.milestones(before, after_) || [];
        if (m.indexOf('all-cut') >= 0) {
          toast('Everything is cut ✂️');
          var c = ctx();
          if (c && c.celebrate) { try { c.celebrate('piece'); } catch (e) { /* ignore */ } }
        }
      } catch (e) { /* ignore */ }
    }
    if (after) after();
  }

  function groupCounts(d, g) {
    var cut = 0, all = 0;
    g.rows.forEach(function (r) {
      if (r.subcuts && r.subcuts.length) return;     // a strip is not a finished piece
      var live = findRow(d, r.id);
      if (!live) return;
      all += live.qty; cut += Math.min(live.qty, live.cutCount);
    });
    return { cut: cut, all: all };
  }

  function renderGroup(body, p, d, g, sys, colours, rerender) {
    var sec = el('section', 'swx-group');
    sec.setAttribute('data-key', g.key);
    if (g.letter) sec.setAttribute('data-letter', g.letter);
    if (g.kind) sec.setAttribute('data-kind', g.kind);
    var hd = el('div', 'swx-group-head');
    var fi = fabricIndexFor(d, g);
    if (g.kind !== 'interfacing') hd.appendChild(chipNode(fi >= 0 ? colours[fi] : null, g.label));
    var title = el('h3', 'swx-h', g.label);
    hd.appendChild(title);
    var cnt = groupCounts(d, g);
    if (cnt.all) hd.appendChild(el('span', 'swx-count', cnt.cut + ' of ' + cnt.all + ' cut'));
    sec.appendChild(hd);
    if (g.kind === 'interfacing') {
      var how = g.application ? APPLY[g.application] : 'The pattern does not say whether this one is fusible or sew-in: check its label.';
      var bits = [how];
      var from = g.rows[0] && g.rows[0].productFrom;
      if (g.product && from && FROM[from]) bits.push('Product ' + FROM[from] + '.');
      sec.appendChild(el('p', 'swx-apply swx-apply-' + (g.application || 'unknown'), bits.join(' ')));
    }
    var list = el('div', 'list swx-list');
    var byId = {};
    g.rows.forEach(function (r) { byId[r.id] = r; });
    g.rows.forEach(function (r) {
      if (r.parentId && byId[r.parentId]) return;    // drawn under its strip
      list.appendChild(rowNode(p, d, r, sys, false, rerender));
      (r.subcuts || []).forEach(function (sid) { if (byId[sid]) list.appendChild(rowNode(p, d, byId[sid], sys, true, rerender)); });
    });
    sec.appendChild(list);
    body.appendChild(sec);
  }

  function dimsText(dims, sys) {
    if (!dims) return '';
    var toIn = function (v) { return dims.unit === 'cm' ? v / 2.54 : v; };
    if (dims.wof) return lengthPlain(toIn(dims.w), sys) + ' × width of fabric';
    var printed = dims.unit === 'cm' ? 'metric' : 'imperial';
    if (printed === sys) return '';                    // the printed text already says it
    return lengthPlain(toIn(dims.w), sys) + (dims.h ? ' × ' + lengthPlain(toIn(dims.h), sys) : '');
  }

  /** A cutting row's note, less what the group already says (its fabric letter, "subcut"). */
  function rowNote(row) {
    var n = String((row && row.note) || '');
    n = n.replace(/\bFabric\s+[A-Z]{1,2}\b\s*,?/g, '').replace(/\bsub-?cut\b\s*,?/gi, '')
      .replace(/^[\s,;·-]+|[\s,;·-]+$/g, '');
    return n.length > 60 ? n.slice(0, 58).replace(/\s+\S*$/, '') + '…' : n;
  }

  function rowNode(p, d, r, sys, isSub, rerender) {
    var live = findRow(d, r.id);
    var done = live ? live.cutCount >= live.qty : false;
    var node = el('div', 'list-item swx-row' + (isSub ? ' is-sub' : '') + (done ? ' is-done' : ''));
    var main = el('div', 'swx-row-main');
    main.appendChild(el('span', 'swx-piece', r.piece));
    var sub = [];
    var dt = dimsText(r.dims, sys);
    if (dt) sub.push(dt);
    if (r.mirrored) sub.push('⇋ mirrored pair');
    if (r.onFold) sub.push('on the fold');
    if (r.subcuts && r.subcuts.length) sub.push('a strip: cut the pieces below from it');
    if (isSub) sub.push('cut from the strip above');
    // The row's own words ("Curvy size only", "long", "Lining Cuddle"): without them a piece
    // listed twice (one per size or view) reads as one piece cut twice (sew-audit, Shannon robe).
    var own = rowNote(live || r);
    if (own) sub.unshift(own);
    if (sub.length) main.appendChild(el('span', 'swx-sub', sub.join(' · ')));
    var f = null;
    if (r.check) {
      var ck = r.check;
      var lead = ck.verdict === 'off' ? 'Comes up short. ' : ck.verdict === 'close' ? 'Only just fits. ' :
        ck.verdict === 'exact' ? 'Adds up. ' : 'Not checked. ';
      f = flag(ck.verdict, lead + (ck.why || ''));
      f.appendChild(el('span', 'swx-by', ' (≈ worked out by the app at ' + lengthPlain(ck.wof || 40, sys) + ' usable)'));

    }
    node.appendChild(main);
    if (!live) {
      node.appendChild(el('span', 'swx-sub swx-notion', 'on the notions list'));
      if (f) node.appendChild(f);
      return node;
    }
    var counter = el('div', 'swx-counter');
    var minus = btn('swx-cut-minus', '−', 'One fewer ' + r.piece + ' cut');
    minus.disabled = live.cutCount <= 0;
    minus.setAttribute('data-focus-key', 'minus-' + r.id);
    on(minus, 'click', function () { setCut(p.id, r.id, live.cutCount - 1, rerender); });
    var chip = btn('chip swx-cut-btn' + (done ? ' is-done' : ''), (done ? '✓ ' : '') + live.cutCount + ' of ' + live.qty + ' cut',
      r.piece + ', ' + live.cutCount + ' of ' + live.qty + ' cut. ' + (done ? 'All cut.' : 'Tap when you have cut one more.'));
    chip.setAttribute('data-focus-key', 'cut-' + r.id);
    on(chip, 'click', function () { setCut(p.id, r.id, live.cutCount + 1, rerender); });
    counter.appendChild(minus);
    counter.appendChild(chip);
    if (live.qty > CUT_TAP_MAX && !done) {
      var all = btn('linkish swx-cut-all', 'All', 'Mark all ' + live.qty + ' ' + r.piece + ' cut');
      all.setAttribute('data-focus-key', 'all-' + r.id);
      on(all, 'click', function () { setCut(p.id, r.id, live.qty, rerender); });
      counter.appendChild(all);
    }
    node.appendChild(counter);
    if (f) node.appendChild(f);
    return node;
  }

  /** "Main Panel · 2 Exterior · 2 Lining · 4 Shape-flex (fusible)" */
  function renderByPiece(body, board) {
    var order = [], at = {};
    board.groups.forEach(function (g) {
      g.rows.forEach(function (r) {
        if (r.parentId) return;
        var k = r.piece.toLowerCase().replace(/\b(?:stabili[sz]er|interfacing)\b/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '') || r.piece.toLowerCase();
        if (at[k] === undefined) { at[k] = order.length; order.push({ name: r.piece, parts: [] }); }
        var lab = g.kind === 'interfacing' ? (g.product || g.label) + (g.application ? ' (' + g.application + ')' : '') : g.label;
        order[at[k]].parts.push(r.qty + ' ' + lab);
      });
    });
    var list = el('div', 'list swx-list swx-bypiece');
    order.forEach(function (o) {
      var n = el('div', 'list-item swx-row');
      var m = el('div', 'swx-row-main');
      m.appendChild(el('span', 'swx-piece', o.name));
      m.appendChild(el('span', 'swx-sub', 'cut ' + o.parts.join(' · ')));
      n.appendChild(m);
      list.appendChild(n);
    });
    body.appendChild(list);
    body.appendChild(el('p', 'field-hint', 'Tick pieces off in the “By fabric” view.'));
  }

  /* ================================================================== *
   * 4. P11 / S2: the quilt top that assembles itself
   * ================================================================== */

  function unitFraction(d) {
    var tot = 0, dn = 0;
    if (d.units && d.units.length) {
      d.units.forEach(function (u) { tot += Math.max(0, u.target | 0); dn += Math.max(0, Math.min(u.target | 0, u.done | 0)); });
      if (tot) return { f: dn / tot, done: dn, total: tot, by: 'units' };
    }
    var steps = (d.steps || []).filter(function (s) { return !s.optional; });
    steps.forEach(function (s) { tot++; if (s.done) dn++; });
    return { f: tot ? dn / tot : 0, done: dn, total: tot, by: 'steps' };
  }
  function keyOfName(name) {
    var m = /(\d{1,2}[a-z]?)\b/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function unitForBlock(d, b) {
    var i;
    if (b.unitId) for (i = 0; i < d.units.length; i++) if (d.units[i].id === b.unitId) return d.units[i];
    var k = keyOfName(b.label);
    if (!k) return null;
    for (i = 0; i < d.units.length; i++) if (keyOfName(d.units[i].name) === k) return d.units[i];
    return null;
  }

  function openQuiltTop(proj, o) {
    var pid = proj.id;
    var ctl = null;
    openSheet('Quilt top', function (body, api, mine) {
      onClosed(mine, function () { if (ctl && ctl.destroy) { try { ctl.destroy(); } catch (e) { /* ignore */ } } ctl = null; });
      var p = projOf(pid);
      var d = dataOf(p), S = Sw();
      var top = S.quiltTop(d);
      var fr = unitFraction(d);
      head(body, fr.total
        ? (fr.by === 'units' ? fr.done + ' of ' + plural(fr.total, 'unit') + ' made' : fr.done + ' of ' + plural(fr.total, 'step') + ' done')
        : 'Nothing to count yet.');

      var stage = el('div', 'swx-quilt-stage');
      body.appendChild(stage);
      var note = el('p', 'swx-quilt-note');
      body.appendChild(note);

      var A = app();
      var tried = (A && typeof A.quiltModel === 'function') ? Promise.resolve().then(function () { return A.quiltModel(pid); }).catch(function () { return null; }) : Promise.resolve(null);
      tried.then(function (got) {
        if (!stage.isConnected && !document.body.contains(stage)) return;
        if (got && got.model && hasQ('mount') && hasQ('progress')) { mountModel(stage, note, got.model, got.image, d); return; }
        if (top.source === 'rows' && top.rows.length) { drawRows(stage, note, p, d, top, fr); return; }
        var pg = top.layoutPage ? pageRow(d, top.layoutPage) : null;
        if (pg && hasQ('mount') && hasQ('pictureModel') && blobs()) { mountPicture(stage, note, pg, d, fr); return; }
        var where = top.layoutPage ? 'The layout picture is on page ' + top.layoutPage + ' of the booklet. ' : '';
        var keepIt = top.layoutPage ? (d.pages && d.pages.length ? 'That page was not kept on this device.'
          : 'Import the PDF with “Keep the pages” ticked to see it here, filling in as a whole.') : '';
        note.textContent = top.source === 'none'
          ? 'This pattern does not describe its layout in words, so there is no quilt top to draw. The app will not guess one.'
          : top.source === 'labels'
            ? where + 'The app read its block labels (below) but not where each block sits, so it does not draw a guess. ' + keepIt
            : (top.why || 'The layout in this pattern is a picture.') + ' ' + where + keepIt;
      });

      if (top.blocks && top.blocks.length) {
        var sec = section(body, 'Blocks on the layout');
        var list = el('div', 'list swx-list');
        top.blocks.forEach(function (b) {
          var u = unitForBlock(d, b);
          var n = el('div', 'list-item swx-row' + (u && u.target && u.done >= u.target ? ' is-done' : ''));
          if (o && o.block && String(o.block).toLowerCase() === String(b.label).toLowerCase()) n.classList.add('is-target');
          var m = el('div', 'swx-row-main');
          m.appendChild(el('span', 'swx-piece', b.label + (b.count > 1 ? ' ×' + b.count : '')));
          var bits = [];
          if (b.name && b.name !== b.label) bits.push(b.name);
          if (u) bits.push(u.name + ': ' + (u.done | 0) + ' of ' + (u.target | 0) + ' made');
          if (b.step) bits.push('step ' + b.step);
          if (bits.length) m.appendChild(el('span', 'swx-sub', bits.join(' · ')));
          n.appendChild(m);
          list.appendChild(n);
        });
        sec.appendChild(list);
      } else if (top.counts && (top.counts.blocks || top.counts.rows)) {
        var bits = [];
        if (top.counts.blocks) bits.push(plural(top.counts.blocks, 'block'));
        if (top.counts.rows) bits.push(plural(top.counts.rows, 'row'));
        body.appendChild(el('p', 'field-hint', 'The pattern text gives ' + bits.join(' in ') + '.'));
      }

      function mountModel(stageEl, noteEl, model, image, dd) {
        var cv = el('canvas', 'swx-quilt-canvas');
        stageEl.appendChild(cv);
        var prog = window.SewQuilt.progress(model, dd);
        try {
          ctl = window.SewQuilt.mount(cv, model, { image: image || null, progress: prog, label: 'Quilt top' });
        } catch (e) { noteEl.textContent = 'The quilt top could not be drawn on this device.'; return; }
        noteEl.textContent = model.mode === 'picture' || !model.blocks.length
          ? 'This layout is a picture, so it fills in as a whole.'
          : prog.done + ' of ' + prog.total + (model.labels === 'rows' ? ' rows' : ' blocks') + ' made' +
            (prog.mapping === 'order' ? '. ≈ They light up in order as you go; the pattern does not say which step makes which.' : '.');
      }

      function mountPicture(stageEl, noteEl, pg, dd, f) {
        noteEl.textContent = 'Loading the layout page…';
        loadImage(pg.blobKey).then(function (img) {
          if (!img) { noteEl.textContent = 'The layout page could not be read on this device.'; return; }
          var model = window.SewQuilt.pictureModel(pg.n, null, 'the layout on page ' + pg.n + ' is a picture, so it fills in as a whole');
          var cv = el('canvas', 'swx-quilt-canvas');
          stageEl.appendChild(cv);
          try {
            ctl = window.SewQuilt.mount(cv, model, { image: img, progress: { byBlock: {}, done: 0, total: 0, fraction: f.f }, label: 'Quilt top' });
          } catch (e) { noteEl.textContent = 'The quilt top could not be drawn on this device.'; return; }
          noteEl.textContent = 'The pattern’s own layout (page ' + pg.n + '). It is a picture, so it fills in as a whole: ' +
            Math.round(f.f * 100) + '% of the ' + (f.by === 'units' ? 'units' : 'steps') + ' done. The app does not guess where each block goes.';
        });
      }
    }, { subject: pid });
  }

  function blobs() { return !!(window.BlobStore && window.BlobStore.available && window.BlobStore.available()); }
  function pageRow(d, n) {
    for (var i = 0; i < (d.pages || []).length; i++) if (d.pages[i].n === n) return d.pages[i];
    return null;
  }
  function loadImage(key) {
    return window.BlobStore.get(key).then(function (blob) {
      if (!blob) return null;
      return new Promise(function (res) {
        var url = URL.createObjectURL(blob);
        var im = new Image();
        im.onload = function () { URL.revokeObjectURL(url); res(im); };
        im.onerror = function () { URL.revokeObjectURL(url); res(null); };
        im.src = url;
      });
    }, function () { return null; });
  }

  /** Catwalk-style rows of fabric letters: drawn from the text, lit in order of progress. */
  function drawRows(stage, note, p, d, top, fr) {
    var NS = 'http://www.w3.org/2000/svg';
    var colours = coloursOf(p, d);
    var rows = top.rows;
    var widths = rows.map(function (r) {
      var last = 1;
      return r.cells.map(function (c) {
        var v = c.size && hasQ('parseMeasure') ? window.SewQuilt.parseMeasure(String(c.size).replace(/["”]/g, '')) : null;
        if (v) last = v;
        return v || last;
      });
    });
    var W = 0;
    widths.forEach(function (w) { var s = 0; w.forEach(function (x) { s += x; }); if (s > W) W = s; });
    var RH = W / Math.max(6, rows.length * 1.1);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (RH * rows.length));
    svg.setAttribute('class', 'swx-rows');
    svg.setAttribute('role', 'img');
    var lit = Math.round(fr.f * rows.length);
    svg.setAttribute('aria-label', 'Quilt top drawn from the pattern’s row list: ' + rows.length + ' rows, ' + lit + ' shown in colour.');
    rows.forEach(function (r, ri) {
      var x = 0;
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'swx-rowband' + (ri < lit ? ' is-made' : ''));
      r.cells.forEach(function (c, ci) {
        var w = widths[ri][ci];
        var idx = fabricIndexFor(d, { letter: c.fabric });
        var rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', ri * RH);
        rect.setAttribute('width', w); rect.setAttribute('height', RH);
        rect.setAttribute('class', 'swx-cell');
        if (idx >= 0 && colours[idx]) rect.style.fill = colours[idx];
        g.appendChild(rect);
        if (w > RH * 0.6) {
          var tx = document.createElementNS(NS, 'text');
          tx.setAttribute('x', x + w / 2); tx.setAttribute('y', ri * RH + RH * 0.62);
          tx.setAttribute('font-size', RH * 0.42);
          tx.setAttribute('text-anchor', 'middle');
          tx.setAttribute('class', 'swx-cell-label');
          tx.textContent = c.fabric;
          g.appendChild(tx);
        }
        x += w;
      });
      svg.appendChild(g);
    });
    stage.appendChild(svg);
    note.textContent = 'Drawn from the rows the pattern lists in words (' + plural(rows.length, 'row') + ', cell widths from its sizes). ' +
      '≈ The rows light up in order as you go; the pattern does not say which step makes which row.' +
      (Object.keys(colours).length ? '' : ' Set fabric colours to see it in your fabrics.');
  }

  /* ================================================================== *
   * 5. P8 / P9: quilt calculators wired to the pattern
   * ================================================================== */

  function openQuiltCalc(proj, o) {
    var pid = proj.id;
    var tool = (o && o.tool) || null;
    var st = null;      // the sewist's inputs, kept while the sheet is open (inches)
    openSheet('Quilt calculators', function (body) {
      function render() {
        clear(body);
        var p = projOf(pid);
        var d = dataOf(p), S = Sw(), Q = S.quilt;
        var sys = systemOf(d);
        var wof = (d.fabricPrefs && d.fabricPrefs.wof) || 40;
        var facts = S.quiltFacts(d, { wof: wof });
        if (!st) {
          st = {
            w: facts.finished ? facts.finished.w : null, h: facts.finished ? facts.finished.h : null,
            strip: facts.binding && facts.binding.printed && facts.binding.printed.stripWidth || 2.5,
            extra: 10, margin: 4, backWof: 42, hst: 3, hstWay: 2, qst: 3, gw: 4, gh: 2, gWay: 1,
            bw: facts.blocks && facts.blocks[0] ? facts.blocks[0].w : null, bh: facts.blocks && facts.blocks[0] ? facts.blocks[0].h : null,
            addRows: 1, addCols: 0
          };
        }
        var fromPattern = facts.finished && st.w === facts.finished.w && st.h === facts.finished.h;
        head(body, facts.finished
          ? 'Finished size printed in the pattern: ' + (facts.finished.text || inchText(facts.finished.w) + ' × ' + inchText(facts.finished.h)) + (facts.finished.page ? ' (page ' + facts.finished.page + ')' : '')
          : 'The pattern prints no finished size that the app could read. Type yours below.');
        body.appendChild(unitSwitch(pid, d, 'quiltcalc', function () { keep(body, render); }));
        body.appendChild(el('p', 'field-hint', 'Type sizes in ' + unitWord(sys) + ', or add the unit ("150 cm", "60\""). ≈ marks every number worked out by the app.'));

        var size = el('div', 'swx-pair');
        size.appendChild(lenField('Quilt width', 'w', sys));
        size.appendChild(lenField('Quilt length', 'h', sys));
        body.appendChild(size);

        // --- binding
        details(body, 'binding', 'Binding', function (sec) {
          sec.appendChild(numRow([lenField('Strip width', 'strip', sys), lenField('Extra for corners and joins', 'extra', sys)]));
          var b = st.w && st.h ? Q.binding({ w: st.w, h: st.h, extra: st.extra, stripWidth: st.strip, wof: wof }) : null;
          if (!b) { sec.appendChild(el('p', 'muted', 'Give the quilt’s size first.')); return; }
          var r = el('p', 'swx-result');
          r.appendChild(document.createTextNode('Length: '));
          r.appendChild(lengthNode(b.length, sys, true, b.why));
          r.appendChild(document.createTextNode(' · ' + plural(b.strips, 'strip') + ' across ' + lengthPlain(wof, sys) + ' usable · '));
          r.appendChild(approx(ydText(b.yards), b.why));
          sec.appendChild(r);
          var pr = facts.binding && facts.binding.printed;
          if (pr && pr.length) {
            var v = fromPattern && facts.binding.check ? facts.binding.check.verdict : compare(b.length, pr.length);
            sec.appendChild(flag(v, verdictWords(v) + ' The pattern prints ' + inchText(pr.length) + '; the app works out ' + lengthPlain(b.length, sys) + '.'));
          }
          sec.appendChild(byApp(b.why));
        });

        // --- backing
        details(body, 'backing', 'Backing', function (sec) {
          sec.appendChild(numRow([lenField('Extra on each side', 'margin', sys), lenField('Backing fabric width', 'backWof', sys)]));
          var k = st.w && st.h ? Q.backing({ w: st.w, h: st.h, margin: st.margin, wof: st.backWof }) : null;
          if (!k) { sec.appendChild(el('p', 'muted', 'Give the quilt’s size first.')); return; }
          var r = el('p', 'swx-result');
          r.appendChild(document.createTextNode(plural(k.widths, 'width') + ' of ' + lengthPlain(st.backWof, sys) + ' fabric, ' + (k.orientation ? k.orientation + ', ' : '')));
          r.appendChild(approx(ydText(k.yards), k.why));
          sec.appendChild(r);
          var pr = facts.backing && facts.backing.printed || [];
          pr.forEach(function (x) {
            var yd = x.amount && x.amount.yd;
            if (!yd) return;
            var v = fromPattern && facts.backing.check ? facts.backing.check.verdict : (yd >= k.yards ? 'exact' : (k.yards - yd <= 0.25 ? 'close' : 'off'));
            sec.appendChild(flag(v, (v === 'exact' ? 'The printed amount covers it. ' : v === 'close' ? 'Close: only just. ' : 'Short. ') +
              'The pattern prints ' + (x.amount.text || yd + ' yd') + (x.name ? ' (' + x.name + ')' : '') + '; the app works out ' + ydText(k.yards) + '.'));
          });
          sec.appendChild(byApp(k.why));
        });

        // --- batting
        details(body, 'batting', 'Batting', function (sec) {
          var bt = st.w && st.h ? Q.batting({ w: st.w, h: st.h, margin: st.margin }) : null;
          if (!bt) { sec.appendChild(el('p', 'muted', 'Give the quilt’s size first.')); return; }
          var r = el('p', 'swx-result');
          r.appendChild(document.createTextNode('Batting at least '));
          r.appendChild(lengthNode(bt.w, sys, true, bt.why));
          r.appendChild(document.createTextNode(' × '));
          r.appendChild(lengthNode(bt.h, sys, true, bt.why));
          sec.appendChild(r);
          var pb = facts.batting && facts.batting.printed;
          if (pb) {
            var ok = pb.w >= bt.w - 0.01 && pb.h >= bt.h - 0.01;
            var near = pb.w >= bt.w - 2 && pb.h >= bt.h - 2;
            sec.appendChild(flag(ok ? 'exact' : near ? 'close' : 'off', 'The pattern suggests ' + (pb.text || inchText(pb.w) + ' × ' + inchText(pb.h)) + '.'));
          }
          sec.appendChild(byApp(bt.why));
        });

        // --- HST / QST
        details(body, 'hst', 'Half-square and quarter-square triangles', function (sec) {
          sec.appendChild(lenField('Finished size of the square', 'hst', sys));
          sec.appendChild(seg([{ id: 2, label: '2 at a time' }, { id: 4, label: '4 at a time' }, { id: 8, label: '8 at a time' }], st.hstWay,
            function (id) { st.hstWay = id; keep(body, render); }, 'Method'));
          if (!(st.hst > 0)) return;
          var h = Q.hst(st.hst, st.hstWay);
          if (h) sec.appendChild(cutList(h, sys));
          var q = Q.qst ? Q.qst(st.hst) : null;
          if (q) {
            sec.appendChild(el('p', 'swx-sub', 'Quarter-square triangles of the same finished size:'));
            sec.appendChild(cutList(q, sys));
          }
        });

        // --- flying geese
        details(body, 'geese', 'Flying geese', function (sec) {
          sec.appendChild(numRow([lenField('Finished width', 'gw', sys), lenField('Finished height', 'gh', sys)]));
          sec.appendChild(seg([{ id: 1, label: 'One at a time' }, { id: 4, label: 'Four at a time' }], st.gWay,
            function (id) { st.gWay = id; keep(body, render); }, 'Geese method'));
          if (!(st.gw > 0 && st.gh > 0)) return;
          var g = Q.geese(st.gw, st.gh, st.gWay);
          if (g) sec.appendChild(cutList(g, sys));
        });

        // --- resize
        details(body, 'resize', 'Make it bigger or smaller', function (sec) {
          sec.appendChild(numRow([lenField('Block width', 'bw', sys), lenField('Block height', 'bh', sys)]));
          var rr = el('div', 'swx-pair');
          rr.appendChild(countField('Rows to add (− to take off)', 'addRows'));
          rr.appendChild(countField('Columns to add', 'addCols'));
          sec.appendChild(rr);
          if (!(st.w && st.h && st.bw && st.bh)) { sec.appendChild(el('p', 'muted', 'Give the quilt’s size and one block’s size.')); return; }
          var z = Q.resize({ w: st.w, h: st.h, block: { w: st.bw, h: st.bh }, addRows: st.addRows | 0, addCols: st.addCols | 0 });
          if (!z) return;
          var r = el('p', 'swx-result');
          r.appendChild(document.createTextNode('New size '));
          r.appendChild(lengthNode(z.w, sys, true, z.why));
          r.appendChild(document.createTextNode(' × '));
          r.appendChild(lengthNode(z.h, sys, true, z.why));
          r.appendChild(document.createTextNode(' · fabric about '));
          r.appendChild(approx('× ' + (Math.round(z.ratio * 100) / 100), z.why));
          sec.appendChild(r);
          sec.appendChild(el('p', 'field-hint', 'A rough guide by area: the pattern’s yardage is for its own size. Re-work the binding and backing above with the new size.'));
          sec.appendChild(byApp(z.why));
        });

        // --- units: should measure, measure it
        if (d.units && d.units.length) {
          details(body, 'units', 'Measure your units', function (sec) {
            sec.appendChild(el('p', 'field-hint', 'Sizes printed in the pattern, before they are sewn into the quilt. Measure one and type it in.'));
            var list = el('div', 'list swx-list');
            d.units.forEach(function (u, ui) { list.appendChild(unitRow(p, d, u, ui, sys)); });
            sec.appendChild(list);
          });
        }

        function verdictWords(v) {
          return v === 'exact' ? 'Matches.' : v === 'close' ? 'Close, not exact.' : v === 'off' ? 'Does not match.' : 'Nothing printed to check against.';
        }
        function lenField(label, key, s) {
          var i = input('text', inputLenValue(st[key], s), '');
          i.className = 'swx-in-short';
          i.setAttribute('data-focus-key', 'calc-' + key);
          i.setAttribute('inputmode', 'decimal');
          on(i, 'change', function () {
            var v = parseLength(i.value, s);
            st[key] = v;
            keep(body, render);
          });
          return field(label + ' (' + (s === 'metric' ? 'cm' : 'in') + ')', i);
        }
        function countField(label, key) {
          var i = input('number', st[key], '0');
          i.className = 'swx-in-short';
          i.setAttribute('data-focus-key', 'calc-' + key);
          on(i, 'change', function () { st[key] = parseInt(i.value, 10) || 0; keep(body, render); });
          return field(label, i);
        }
      }
      function details(b, id, title, fill) {
        var det = el('details', 'swx-tool');
        det.setAttribute('data-tool', id);
        det.open = tool === id || (!tool && id === 'binding');
        on(det, 'toggle', function () { if (det.open) tool = id; });
        det.appendChild(el('summary', null, title));
        var sec = el('div', 'swx-tool-body');
        det.appendChild(sec);
        fill(sec);
        b.appendChild(det);
      }
      render();
      if (tool) {
        var t = body.querySelector('[data-tool="' + tool + '"]');
        if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ } }
      }
    }, { subject: pid });
  }

  function numRow(nodes) {
    var r = el('div', 'swx-pair');
    nodes.forEach(function (n) { r.appendChild(n); });
    return r;
  }
  function cutList(res, sys) {
    var w = el('div', 'swx-cutlist');
    (res.cut || []).forEach(function (c) {
      var p = el('p', 'swx-result');
      p.appendChild(document.createTextNode((c.qty ? 'Cut ' + c.qty + ' ' : '') + (c.what || '') + ': '));
      var s = c.size;
      if (s && typeof s === 'object') {
        p.appendChild(lengthNode(s.w, sys, true, res.why));
        p.appendChild(document.createTextNode(' × '));
        p.appendChild(lengthNode(s.h, sys, true, res.why));
      } else if (typeof s === 'number') {
        p.appendChild(lengthNode(s, sys, true, res.why));
      }
      if (c.note) p.appendChild(el('span', 'swx-sub', ' ' + c.note));
      w.appendChild(p);
    });
    var bits = [];
    if (res.yield) bits.push('makes ' + res.yield);
    if (res.unfinished) bits.push('each ' + lengthPlain(res.unfinished, sys) + ' before trimming');
    if (res.exact === false) bits.push('cut a little big and trim');
    if (bits.length) w.appendChild(el('p', 'swx-sub', bits.join(' · ')));
    w.appendChild(byApp(res.why));
    return w;
  }

  function unitRow(p, d, u, ui, sys) {
    var n = el('div', 'list-item swx-row swx-unit' + (u.measured ? ' is-done' : ''));
    var m = el('div', 'swx-row-main');
    m.appendChild(el('span', 'swx-piece', u.name + ' · ' + (u.done | 0) + ' of ' + (u.target | 0) + ' made'));
    var dims = u.size && has('dims') ? Sw().dims(u.size) : null;
    if (u.size) m.appendChild(el('span', 'swx-sub', 'Should measure ' + u.size + (dims && sys === 'metric' && dims.unit !== 'cm' ? ' (' + lengthPlain(dims.w, sys) + ' × ' + lengthPlain(dims.h || dims.w, sys) + ')' : '')));
    else m.appendChild(el('span', 'swx-sub', 'The pattern prints no size for this unit.'));
    var res = el('div', 'swx-measure');
    if (dims) {
      var i = input('text', '', sys === 'metric' ? 'e.g. 16.5 x 31.8' : 'e.g. 6 1/2 x 12 1/2');
      i.className = 'swx-in-mid';
      i.setAttribute('aria-label', 'What your ' + u.name + ' measures');
      i.setAttribute('data-focus-key', 'measure-' + u.id);
      var out = el('div', 'swx-measure-out');
      out.setAttribute('aria-live', 'polite');
      on(i, 'change', function () {
        clear(out);
        var got = parsePair(i.value, sys);
        if (!got) return;
        var toIn = function (v) { return dims.unit === 'cm' ? v / 2.54 : v; };
        var W = toIn(dims.w), H = toIn(dims.h || dims.w);
        var a = Math.abs(got.w - W) <= 0.0625 && Math.abs(got.h - H) <= 0.0625;
        var b = Math.abs(got.w - H) <= 0.0625 && Math.abs(got.h - W) <= 0.0625;
        if (a || b) out.appendChild(flag('exact', 'Measures right.'));
        else {
          var dw = Math.max(Math.abs(got.w - W), Math.abs(got.h - H));
          var big = got.w + got.h > W + H;
          out.appendChild(flag(dw <= 0.125 ? 'close' : 'off', (dw <= 0.125 ? 'Close: within 1/8". ' : 'Off by ') +
            (dw > 0.125 ? lengthPlain(dw, sys) + '. ' : '') + (big ? 'Trim it to size.' : 'Check your seam allowance: it is coming out small.')));
        }
      });
      res.appendChild(i);
      res.appendChild(out);
    }
    m.appendChild(res);
    n.appendChild(m);
    var ok = btn('chip swx-measured' + (u.measured ? ' is-done' : ''), u.measured ? '✓ Measured right' : 'Measured right?',
      u.measured ? u.name + ' marked as measured right. Tap to undo.' : 'Mark ' + u.name + ' as measured right');
    ok.setAttribute('aria-pressed', u.measured ? 'true' : 'false');
    ok.setAttribute('data-focus-key', 'measured-' + u.id);
    on(ok, 'click', function () {
      edit(p.id, function (dd) {
        var x = dd.units[ui];
        if (!x || x.id !== u.id) { for (var k = 0; k < dd.units.length; k++) if (dd.units[k].id === u.id) x = dd.units[k]; }
        if (!x) return;
        if (x.measured) delete x.measured; else x.measured = true;
      }, 'quiltcalc', 'unit');
      u.measured = !u.measured;
      ok.textContent = u.measured ? '✓ Measured right' : 'Measured right?';
      ok.setAttribute('aria-pressed', u.measured ? 'true' : 'false');
      n.classList.toggle('is-done', !!u.measured);
      announce(u.name + (u.measured ? ' measured right' : ' not marked'));
    });
    n.appendChild(ok);
    return n;
  }

  /* ================================================================== *
   * 6. P13: fabric calculator and shopping list v2
   * ================================================================== */

  function openFabric(proj, o) {
    var pid = proj.id;
    var all = !!(o && o.all);
    openSheet('Fabric and shopping list', function (body) {
      function render() {
        clear(body);
        var p = projOf(pid);
        var d = dataOf(p), S = Sw();
        var fp = d.fabricPrefs || {};
        var sys = systemOf(d);
        var size = chosenSize(p, d);
        var opts = { size: size || undefined, view: fp.view, width: fp.width, nap: !!fp.nap, shrinkPct: fp.shrinkPct, unit: fp.unit };
        if (o && o.view) opts.view = o.view;
        var need = S.fabricNeed(d, opts);
        head(body, size ? 'For size ' + size + '.' : (d.size && d.size.sizeLabels && d.size.sizeLabels.length ? 'No size chosen yet: pick one on the Size sheet to see one figure per fabric.' : 'Amounts as the pattern prints them.'));

        // controls
        var ctl = section(body, 'Your fabric');
        var wrow = el('div', 'swx-pair');
        var wv = input('text', fp.width ? fp.width.value : '', sys === 'metric' ? 'e.g. 140' : 'e.g. 54');
        wv.className = 'swx-in-short';
        wv.setAttribute('data-focus-key', 'fab-width');
        var wu = document.createElement('select');
        wu.setAttribute('data-focus-key', 'fab-width-unit');
        [['cm', 'cm'], ['in', 'inches']].forEach(function (x) { var op = el('option', null, x[1]); op.value = x[0]; wu.appendChild(op); });
        wu.value = fp.width ? fp.width.unit : (sys === 'metric' ? 'cm' : 'in');
        var saveW = function () {
          var v = parseFloat(String(wv.value).replace(',', '.'));
          setPrefs(pid, { width: isFinite(v) && v > 0 ? { value: v, unit: wu.value } : null }, 'fabric');
          keep(body, render);
        };
        on(wv, 'change', saveW);
        on(wu, 'change', function () { if (wv.value) saveW(); });
        wrow.appendChild(field('My fabric is this wide', wv));
        wrow.appendChild(field('Unit', wu));
        ctl.appendChild(wrow);
        var sh = input('number', fp.shrinkPct || '', 'e.g. 3');
        sh.className = 'swx-in-short';
        sh.min = '0'; sh.max = '30';
        sh.setAttribute('data-focus-key', 'fab-shrink');
        on(sh, 'change', function () {
          var v = parseFloat(sh.value);
          setPrefs(pid, { shrinkPct: isFinite(v) && v > 0 && v <= 30 ? v : null }, 'fabric');
          keep(body, render);
        });
        ctl.appendChild(field('Shrinkage when pre-washed (%)', sh, 'Adds that much to each length, approximately. Leave empty for none.'));
        ctl.appendChild(switchRow('Nap or one-way print', 'Velvet, corduroy, prints with a direction', !!fp.nap, function (v) {
          setPrefs(pid, { nap: v ? true : null }, 'fabric');
          keep(body, render);
        }));
        var views = [];
        need.lines.forEach(function (l) { if (l.view && views.indexOf(l.view) < 0) views.push(l.view); });
        if (views.length > 1 || fp.view) {
          var vs = document.createElement('select');
          vs.setAttribute('data-focus-key', 'fab-view');
          var op0 = el('option', null, 'Every view'); op0.value = ''; vs.appendChild(op0);
          views.forEach(function (v) { var op = el('option', null, v); op.value = v; vs.appendChild(op); });
          vs.value = fp.view || '';
          on(vs, 'change', function () { setPrefs(pid, { view: vs.value || null }, 'fabric'); keep(body, render); });
          ctl.appendChild(field('View', vs));
        }
        ctl.appendChild(unitSwitch(pid, d, 'fabric', function () { keep(body, render); }));

        // results
        var res = section(body, 'What to buy');
        if (!need.lines.length && !need.uncovered.length) res.appendChild(el('p', 'muted', 'The pattern lists no fabric amounts the app could read.'));
        need.lines.forEach(function (l) { res.appendChild(fabricLine(l, opts)); });
        need.uncovered.forEach(function (u) {
          var n = el('div', 'swx-fabline');
          n.appendChild(el('span', 'swx-piece', u.name));
          n.appendChild(flag('unchecked', u.why));
          res.appendChild(n);
        });
        (need.notes || []).forEach(function (t) { res.appendChild(el('p', 'field-hint', t)); });
        if (fp.width) res.appendChild(el('p', 'field-hint', 'The app picks the widest width the pattern prints that is not wider than yours, and never guesses between widths: layouts do not scale in a straight line.'));
        // What the step screen's old Fabric sheet showed (this is now the one fabric sheet):
        // every row as printed, the nap sentences, "What I actually used".
        var SA = window.SewingApp;
        if (SA && typeof SA.fabricOwnParts === 'function') {
          var own = el('div', 'swx-fabric-own');
          try { SA.fabricOwnParts(own, pid); } catch (e) { /* the app's part is optional */ }
          if (own.childNodes.length) res.appendChild(own);
        }

        // shopping list
        var shop = section(body, 'Shopping list', 'swx-shop');
        shop.appendChild(switchRow('All my sewing projects', 'One list for everything you are making', all, function (v) { all = v; keep(body, render); }));
        var items = all ? acrossProjects(opts) : S.shoppingListV2(d, opts);
        renderShop(shop, p, d, items, all, function () { keep(body, render); });
      }
      render();
    }, { subject: pid });
  }

  function fabricLine(l, opts) {
    var n = el('div', 'swx-fabline');
    n.appendChild(el('span', 'swx-piece', l.name + (l.view ? ' · ' + l.view : '')));
    var a = el('div', 'swx-result');
    if (l.amount) {
      if (l.amount.approxOther || /^\s*≈/.test(l.amount.text)) a.appendChild(approx(l.amount.text, 'converted from the pattern’s units'));
      else a.appendChild(el('span', 'swx-num', l.amount.text));
      if (l.amount.precut) a.appendChild(el('span', 'swx-sub', ' (' + l.amount.precut + ')'));
      if (l.amount.included) a.appendChild(el('span', 'swx-sub', ' (included in the line above)'));
    } else a.appendChild(el('span', 'muted', 'no amount printed'));
    if (l.printedWidth && opts.width) a.appendChild(el('span', 'swx-sub', ' · the pattern’s figure for ' + l.printedWidth + ' fabric'));
    n.appendChild(a);
    if (l.why) n.appendChild(el('p', 'field-hint', l.why));
    if (l.shrink && l.shrink.amount) {
      var s = el('p', 'swx-result');
      s.appendChild(document.createTextNode('With ' + l.shrink.pct + '% shrinkage: '));
      s.appendChild(approx(l.shrink.amount.text, 'the length plus ' + l.shrink.pct + '%'));
      s.appendChild(el('span', 'swx-by', ' (worked out by the app)'));
      n.appendChild(s);
    }
    if (opts.nap) {
      if (l.nap === 'printed') n.appendChild(flag('exact', 'This is the pattern’s own with-nap figure.'));
      else if (l.nap === 'not printed') n.appendChild(flag('unchecked', 'The pattern prints no with-nap figure. Buy extra, or lay the pieces out all one way and measure.'));
    }
    return n;
  }

  function acrossProjects(opts) {
    var S = Sw(), St_ = St();
    var list = (St_.projects ? St_.projects() : []).filter(function (p) {
      return p && p.craft === 'sewing' && p.status !== 'finished' && p.status !== 'archived' && !p.deletedAt;
    });
    var lists = [], names = [];
    list.forEach(function (p) {
      try {
        var d = dataOf(p), fp = d.fabricPrefs || {};
        lists.push(S.shoppingListV2(d, { size: d.size.chosen || undefined, view: fp.view, width: fp.width, nap: !!fp.nap, shrinkPct: fp.shrinkPct, unit: fp.unit })
          .filter(function (it) { return !it.have; }));
        names.push(p.name);
      } catch (e) { /* skip a broken project */ }
    });
    var merged = has('mergeShopping') ? S.mergeShopping(lists) : [];
    merged.forEach(function (m) { m.fromNames = (m.from || []).map(function (i) { return names[i]; }); });
    return merged;
  }

  var SECTION_NAMES = { fabric: 'Fabric', notions: 'Notions', thread: 'Thread', other: 'Also' };
  function renderShop(sec, p, d, items, all, rerender) {
    var order = ['fabric', 'notions', 'thread', 'other'];
    if (!items.length) sec.appendChild(el('p', 'muted', 'Nothing to buy: everything is ticked as already had.'));
    order.forEach(function (k) {
      var rows = items.filter(function (it) { return (it.section || 'other') === k; });
      if (!rows.length) return;
      sec.appendChild(el('h4', 'swx-h4', SECTION_NAMES[k]));
      var list = el('div', 'list swx-list');
      rows.forEach(function (it) {
        var n = el('div', 'list-item swx-row' + (it.have ? ' is-done' : ''));
        if (!all && it.id) {
          var c = btn('check', '✓', (it.have ? 'Mark as still to buy: ' : 'Already have: ') + it.text);
          c.setAttribute('role', 'checkbox');
          c.setAttribute('aria-checked', it.have ? 'true' : 'false');
          c.setAttribute('data-focus-key', 'have-' + it.id);
          on(c, 'click', function () {
            edit(p.id, function (dd) { (dd.notions || []).forEach(function (x) { if (x.id === it.id) x.have = !x.have; }); }, 'fabric', 'prefs');
            rerender();
          });
          n.appendChild(c);
        }
        var m = el('div', 'swx-row-main');
        m.appendChild(el('span', 'swx-piece', it.text));
        var sub = [];
        if (all && it.fromNames && it.fromNames.length) sub.push(it.fromNames.join(', '));
        if (it.page) sub.push(pageText(it.page));
        if (sub.length) m.appendChild(el('span', 'swx-sub', sub.join(' · ')));
        n.appendChild(m);
        list.appendChild(n);
      });
      sec.appendChild(list);
    });
    var text = shopText(all ? 'Shopping list — all my sewing' : 'Shopping list — ' + (p.name || 'my project'), items);
    var bar = el('div', 'swx-actions');
    var copy = btn('btn', 'Copy the list');
    copy.setAttribute('data-focus-key', 'shop-copy');
    on(copy, 'click', function () { copyText(text); });
    bar.appendChild(copy);
    if (navigator.share) {
      var share = btn('btn ghost', 'Share…');
      on(share, 'click', function () {
        try { navigator.share({ title: 'Shopping list', text: text }).catch(function () { /* cancelled */ }); } catch (e) { copyText(text); }
      });
      bar.appendChild(share);
    }
    sec.appendChild(bar);
  }

  function shopText(title, items) {
    var out = [title];
    ['fabric', 'notions', 'thread', 'other'].forEach(function (k) {
      var rows = items.filter(function (it) { return (it.section || 'other') === k && !it.have; });
      if (!rows.length) return;
      out.push('', SECTION_NAMES[k]);
      rows.forEach(function (it) { out.push('- ' + it.text); });
    });
    return out.join('\n');
  }
  function copyText(text) {
    var done = function () { toast('Shopping list copied'); };
    var fallback = function () {
      var ta = el('textarea', 'swx-offscreen');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else toast('Could not copy here: select the list and copy it by hand');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  /* ================================================================== *
   * 7. P12 / S1: fabric colours (the booklet's swatch, else a chip)
   * ================================================================== */

  function openSwatches(proj, o) {
    var pid = proj.id;
    var urls = [];
    openSheet('Fabric colours', function (body, api, mine) {
      onClosed(mine, function () { urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } }); urls = []; });
      function render() {
        clear(body);
        var p = projOf(pid), d = dataOf(p);
        var colours = coloursOf(p, d);
        head(body, 'The booklet’s own swatch where it was captured cleanly; otherwise a colour you set. They show on the cutting board and the quilt top.');
        var A = app();
        if (A && typeof A.captureSwatches === 'function') {
          var cap = btn('btn ghost block', 'Read the swatches from the booklet');
          on(cap, 'click', function () {
            cap.disabled = true;
            cap.textContent = 'Reading…';
            Promise.resolve().then(function () { return A.captureSwatches(pid); }).then(function () { keep(body, render); }, function () {
              toast('The swatches could not be read here'); keep(body, render);
            });
          });
          body.appendChild(cap);
        }
        var list = el('div', 'list swx-list');
        (d.fabric || []).forEach(function (f, i) {
          var n = el('div', 'list-item swx-row swx-swatch-row');
          if (o && o.fabric === i) n.classList.add('is-target');
          var pic = el('span', 'swx-swatch');
          pic.appendChild(chipNode(colours[i] || null, f.name));
          n.appendChild(pic);
          var m = el('div', 'swx-row-main');
          m.appendChild(el('span', 'swx-piece', f.name));
          var src = el('span', 'swx-sub', colours[i] ? 'Your colour' : 'No colour set');
          m.appendChild(src);
          n.appendChild(m);
          var pick = input('color', colours[i] || '#cccccc');
          pick.setAttribute('aria-label', 'Colour for ' + f.name);
          pick.setAttribute('data-focus-key', 'colour-' + i);
          pick.className = 'swx-colour';
          on(pick, 'change', function () { setColour(pid, i, pick.value); keep(body, render); });
          n.appendChild(pick);
          if (colours[i]) {
            var cl = btn('linkish', 'Clear', 'Clear the colour for ' + f.name);
            cl.setAttribute('data-focus-key', 'clear-' + i);
            on(cl, 'click', function () { setColour(pid, i, null); keep(body, render); });
            n.appendChild(cl);
          }
          list.appendChild(n);
          // the booklet's own swatch, when one was captured
          if (blobs()) {
            window.BlobStore.get('p:' + pid + ':swatch:' + i).then(function (blob) {
              if (!blob || !pic.isConnected) return;
              var url = URL.createObjectURL(blob);
              urls.push(url);
              var im = el('img', 'swx-swatch-img');
              im.alt = 'The booklet’s swatch for ' + f.name;
              im.src = url;
              clear(pic);
              pic.appendChild(im);
              src.textContent = 'From the booklet' + (colours[i] ? ' · your colour is used for drawings' : '');
            }, function () { /* none */ });
          }
        });
        if (!d.fabric.length) body.appendChild(el('p', 'muted', 'This project has no fabric rows yet.'));
        body.appendChild(list);
      }
      render();
    }, { subject: pid });
  }

  /* ================================================================== *
   * 8. P16: press / fuse timer, and the glossary
   * ================================================================== */

  function openTimer(proj, o) {
    var pid = proj.id;
    openSheet('Press and fuse timer', function (body, api, mine) {
      var p = projOf(pid), d = dataOf(p), S = Sw();
      var idx = o && typeof o.step === 'number' ? o.step : currentStep(p, d);
      var step = d.steps[idx];
      var secs = d.fabricPrefs && d.fabricPrefs.fuseSeconds || null;
      var info = step ? S.pressTimer(step.text, secs) : null;
      if (step) {
        head(body, info ? 'Step ' + (step.n || idx + 1) + ' says to ' + info.kind + '.' : 'Step ' + (step.n || idx + 1) + ' does not mention pressing or fusing.');
      }
      var si = input('number', secs || '', 'seconds');
      si.min = '1'; si.max = '600';
      si.className = 'swx-in-short';
      body.appendChild(field('Your time, in seconds', si, 'From your interfacing’s or fabric’s own instructions. The app has no default: every product is different.'));
      var face = el('div', 'swx-timer', secs ? fmtTime(secs) : '–:––');
      face.setAttribute('role', 'timer');
      face.setAttribute('aria-live', 'off');
      body.appendChild(face);
      var status = el('p', 'swx-timer-status');
      status.setAttribute('aria-live', 'polite');
      body.appendChild(status);
      var bar = el('div', 'swx-actions');
      var go = btn('btn primary', 'Start');
      var reset = btn('btn ghost', 'Reset');
      bar.appendChild(go);
      bar.appendChild(reset);
      body.appendChild(bar);
      body.appendChild(el('p', 'field-hint', 'It counts while this screen is on and the app is open. A phone that locks its screen pauses it, so keep the screen awake while you press.'));
      var c = ctx();
      var wakeOk = false;
      try { wakeOk = !!(c && c.wake && (typeof c.wake.supported === 'function' ? c.wake.supported() : c.wake.supported)); } catch (e) { wakeOk = false; }
      if (wakeOk) {
        body.appendChild(switchRow('Keep the screen awake', null, c.wake.isOn(), function (v) {
          if (v !== c.wake.isOn()) c.wake.toggle();
        }));
      }

      var total = secs || 0, left = total, endAt = 0, timer = 0;
      function paint() { face.textContent = total ? fmtTime(Math.ceil(left)) : '–:––'; go.disabled = !total; }
      function stop() { if (timer) { window.clearInterval(timer); timer = 0; } }
      function tick() {
        if (!face.isConnected) { stop(); return; }
        left = Math.max(0, (endAt - Date.now()) / 1000);
        paint();
        if (left <= 0) {
          stop();
          go.textContent = 'Start';
          status.textContent = 'Time is up.';
          face.classList.add('is-up');
          try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ }
          fb('done');
        }
      }
      on(si, 'change', function () {
        var v = parseInt(si.value, 10);
        if (!(v > 0 && v <= 600)) { toast('Give a time from 1 to 600 seconds'); return; }
        stop();
        total = left = v;
        go.textContent = 'Start';
        face.classList.remove('is-up');
        setPrefs(pid, { fuseSeconds: v }, 'timer');
        status.textContent = '';
        paint();
      });
      on(go, 'click', function () {
        if (!total) return;
        if (timer) { stop(); left = Math.max(0, (endAt - Date.now()) / 1000); go.textContent = 'Go on'; status.textContent = 'Paused.'; return; }
        if (left <= 0) left = total;
        face.classList.remove('is-up');
        endAt = Date.now() + left * 1000;
        timer = window.setInterval(tick, 200);
        go.textContent = 'Pause';
        status.textContent = 'Counting down from ' + Math.ceil(left) + ' seconds.';
      });
      on(reset, 'click', function () {
        stop(); left = total; go.textContent = 'Start'; face.classList.remove('is-up'); status.textContent = ''; paint();
      });
      onClosed(mine, stop);
      paint();
      mine.timer = { start: function () { go.click(); }, state: function () { return { total: total, left: left, running: !!timer }; } };
    }, { subject: pid });
  }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function glossaryText(d) {
    if (d.sourceText) return d.sourceText;
    return (d.steps || []).map(function (s) { return s.text; }).join('\n');
  }

  function openGlossary(proj, o) {
    var pid = proj.id;
    var q = (o && o.term) || '';
    openSheet('Words in this pattern', function (body) {
      var p = projOf(pid), d = dataOf(p);
      var g = Sw().glossary(glossaryText(d)) || { inPattern: [], booklet: [] };
      var search = input('search', q, 'Find a word');
      search.setAttribute('aria-label', 'Find a word');
      body.appendChild(search);
      var holder = el('div', 'swx-gloss');
      body.appendChild(holder);
      function render() {
        clear(holder);
        var needle = search.value.toLowerCase().replace(/^\s+|\s+$/g, '');
        var match = function (t) { return !needle || String(t).toLowerCase().indexOf(needle) >= 0; };
        var bk = g.booklet.filter(function (x) { return match(x.term) || match(x.text); });
        var ip = g.inPattern.filter(function (x) { return match(x.term) || match(x.def); });
        if (bk.length) {
          var s1 = section(holder, 'From the booklet');
          var dl = el('dl', 'swx-dl');
          bk.forEach(function (x) {
            dl.appendChild(el('dt', null, x.term));
            var dd = el('dd', null, x.text);
            if (x.page) dd.appendChild(el('span', 'swx-sub', ' · ' + pageText(x.page)));
            dl.appendChild(dd);
          });
          s1.appendChild(dl);
        }
        if (ip.length) {
          var s2 = section(holder, 'Used in this pattern');
          s2.appendChild(el('p', 'field-hint', 'Most used first. The meanings are the app’s own short words, not the pattern’s.'));
          var dl2 = el('dl', 'swx-dl');
          ip.forEach(function (x) {
            var dt = el('dt', null, x.term);
            dt.appendChild(el('span', 'swx-sub', ' ×' + x.count));
            dl2.appendChild(dt);
            dl2.appendChild(el('dd', null, x.def));
          });
          s2.appendChild(dl2);
        }
        if (!bk.length && !ip.length) holder.appendChild(el('p', 'muted', needle ? 'No word here matches “' + search.value + '”.' : 'No sewing terms were found in this pattern’s text.'));
      }
      on(search, 'input', render);
      render();
    }, { subject: pid });
  }

  /* ================================================================== *
   * 9. P17: fitting log and alterations that carry forward
   * ================================================================== */

  function fitKey(pid, aid) { return 'p:' + pid + ':fit:' + aid; }
  function newId() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /** Scale a photo down (longest side 1280) and store it; resolves the key or null. */
  function storePhoto(pid, aid, file) {
    if (!file || !blobs()) return Promise.resolve(null);
    var key = fitKey(pid, aid);
    return new Promise(function (res) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var max = 1280, s = Math.min(1, max / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(im.naturalWidth * s));
        cv.height = Math.max(1, Math.round(im.naturalHeight * s));
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        cv.toBlob(function (blob) {
          cv.width = cv.height = 0;
          if (!blob) { res(null); return; }
          window.BlobStore.put(key, blob).then(function () { res(key); }, function () { res(null); });
        }, 'image/jpeg', 0.85);
      };
      im.onerror = function () { URL.revokeObjectURL(url); res(null); };
      im.src = url;
    });
  }

  function sameMakes(p, d) {
    var name = (d.meta && d.meta.patternName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!name) return [];
    return (St().projects() || []).filter(function (q) {
      if (!q || q.id === p.id || q.craft !== 'sewing') return false;
      var qd = dataOf(q);
      var qn = (qd.meta && qd.meta.patternName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
      return qn === name && qd.fitting && qd.fitting.length;
    });
  }

  function openFitting(proj, o) {
    var pid = proj.id;
    var adding = !!(o && o.add);
    var urls = [];
    openSheet('Fitting log', function (body, api, mine) {
      onClosed(mine, function () { urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } }); urls = []; });
      function render() {
        clear(body);
        var p = projOf(pid), d = dataOf(p);
        var sys = systemOf(d);
        var log = d.fitting || [];
        head(body, log.length ? plural(log.length, 'change') + ' noted for this make.' : 'Note each change as you fit: where, how much, which piece and why. Next time you sew this pattern they are still here.');

        sameMakes(p, d).forEach(function (q) {
          var qd = dataOf(q);
          var b = btn('btn ghost block swx-carry', 'Use ' + plural(qd.fitting.length, 'change') + ' from “' + q.name + '”');
          on(b, 'click', function () {
            var n = 0;
            edit(pid, function (dd) { n = Sw().carryAlterations(qd, dd); }, 'fitting', 'fitting');
            toast(n ? plural(n, 'change') + ' copied from last time' : 'Those changes are already here');
            keep(body, render);
          });
          body.appendChild(b);
        });

        if (adding) body.appendChild(form(p, d, sys));
        else {
          var add = btn('btn primary block', '＋ Note a change');
          add.setAttribute('data-focus-key', 'fit-add');
          on(add, 'click', function () { adding = true; render(); var f = body.querySelector('.swx-fit-form input'); if (f) f.focus(); });
          body.appendChild(add);
        }

        var list = el('div', 'list swx-list swx-fitlog');
        log.slice().reverse().forEach(function (e) { list.appendChild(entryNode(e)); });
        body.appendChild(list);
      }

      function entryNode(e) {
        var n = el('div', 'list-item swx-row swx-fit');
        var m = el('div', 'swx-row-main');
        var what = [];
        if (e.at) what.push(e.at);
        if (e.amount) what.push((e.amount.value > 0 ? '+' : '') + e.amount.value + ' ' + e.amount.unit);
        if (e.piece) what.push(e.piece);
        m.appendChild(el('span', 'swx-piece', what.join(' · ') || 'A note'));
        if (e.why) m.appendChild(el('span', 'swx-sub', e.why));
        m.appendChild(el('span', 'swx-sub', (e.date || '') + (e.carried ? ' · from last time' : '')));
        n.appendChild(m);
        if (e.photo && blobs()) {
          var holder = el('span', 'swx-fit-photo');
          n.appendChild(holder);
          window.BlobStore.get(e.photo).then(function (blob) {
            if (!blob || !holder.isConnected) return;
            var url = URL.createObjectURL(blob);
            urls.push(url);
            var im = el('img');
            im.alt = 'Fitting photo, ' + (e.date || '');
            im.src = url;
            holder.appendChild(im);
          }, function () { /* gone */ });
        }
        var del = btn('linkish swx-fit-del', 'Remove', 'Remove this change: ' + (what.join(', ') || e.why));
        on(del, 'click', function () {
          edit(pid, function (dd) { dd.fitting = (dd.fitting || []).filter(function (x) { return x.id !== e.id; }); }, 'fitting', 'fitting');
          toast('Removed. Undo puts it back.');
          var b = body;
          keep(b, render);
        });
        n.appendChild(del);
        return n;
      }

      function form(p, d, sys) {
        var f = el('div', 'swx-fit-form');
        var at = input('text', '', 'e.g. at the lengthen / shorten line');
        var amt = input('text', '', sys === 'metric' ? 'e.g. 3' : 'e.g. 1 1/4');
        amt.className = 'swx-in-short';
        var unit = document.createElement('select');
        [['cm', 'cm'], ['in', 'inches']].forEach(function (x) { var op = el('option', null, x[1]); op.value = x[0]; unit.appendChild(op); });
        unit.value = sys === 'metric' ? 'cm' : 'in';
        var piece = input('text', '', 'e.g. Front and Back Skirt');
        var why = document.createElement('textarea');
        why.rows = 2;
        why.placeholder = 'e.g. I am tall; the hem sat too high';
        var photo = input('file');
        photo.accept = 'image/*';
        f.appendChild(field('Where', at));
        var row = el('div', 'swx-pair');
        row.appendChild(field('How much (− to take in or shorten)', amt));
        row.appendChild(field('Unit', unit));
        f.appendChild(row);
        f.appendChild(field('Which piece', piece));
        f.appendChild(field('Why, or a note from this fitting', why));
        if (blobs()) f.appendChild(field('A photo (optional)', photo, 'Kept on this device with the project, and in your backups.'));
        var bar = el('div', 'swx-actions');
        var cancel = btn('btn ghost', 'Cancel');
        var save = btn('btn primary', 'Save');
        on(cancel, 'click', function () { adding = false; render(); });
        on(save, 'click', function () {
          var v = String(amt.value).replace(/^\s+|\s+$/g, '');
          var val = null;
          if (v) {
            var neg = /^[−-]/.test(v);
            var len = parseLength(v.replace(/^[−+-]\s*/, ''), unit.value === 'in' ? 'imperial' : 'metric');
            if (len === null) { toast('The amount is not a number'); return; }
            val = unit.value === 'in' ? Math.round(len * 1000) / 1000 : Math.round(len * 2.54 * 100) / 100;
            if (neg) val = -val;
          }
          var entry = { id: newId(), at: at.value, amount: val === null ? null : { value: val, unit: unit.value }, piece: piece.value, why: why.value };
          if (!entry.at && !entry.piece && !entry.why && val === null) { toast('Write where, how much, or why first'); return; }
          save.disabled = true;
          var file = photo.files && photo.files[0];
          (file ? storePhoto(pid, entry.id, file) : Promise.resolve(null)).then(function (key) {
            if (key) entry.photo = key;
            if (file && !key) toast('The photo could not be kept on this device; the note is saved');
            edit(pid, function (dd) { Sw().addAlteration(dd, entry); }, 'fitting', 'fitting');
            adding = false;
            announce('Change noted');
            render();
          });
        });
        bar.appendChild(cancel);
        bar.appendChild(save);
        f.appendChild(bar);
        return f;
      }
      render();
    }, { subject: pid });
  }

  /* ================================================================== *
   * 10. Menu and the public object
   * ================================================================== */

  function isQuilt(d) {
    if (d.kind === 'quilt') return true;
    if (d.kind) return false;
    return !!(d.units && d.units.length);
  }

  var ITEMS = [
    { id: 'board', label: 'Cutting board', icon: '✂️', hint: 'Pieces by fabric, strips that check out, interfacing',
      ok: function (d) { return has('cuttingBoard') && has('cutTotals') && d.cutting.length > 0; }, open: openBoard },
    { id: 'quilttop', label: 'Quilt top', icon: '🧩', hint: 'The quilt filling in as you make it',
      ok: function (d) { return has('quiltTop') && isQuilt(d); }, open: openQuiltTop },
    { id: 'quiltcalc', label: 'Quilt calculators', icon: '🧮', hint: 'Binding, backing, batting, triangles, geese, resizing',
      ok: function (d) { return has('quiltFacts') && has('quilt.binding') && has('quilt.backing') && has('quilt.batting') &&
        has('quilt.hst') && has('quilt.geese') && has('quilt.resize') && isQuilt(d); }, open: openQuiltCalc },
    { id: 'fabric', label: 'Fabric and shopping list', icon: '🛍️', hint: 'Fabric for your width, shrinkage, nap; a list to copy',
      ok: function () { return has('fabricNeed') && has('shoppingListV2'); }, open: openFabric },
    { id: 'swatches', label: 'Fabric colours', icon: '🎨', hint: 'The booklet’s swatches, or colours you set',
      ok: function (d) { return d.fabric.length > 0 && !!St().craftSettings; }, open: openSwatches },
    { id: 'timer', label: 'Press and fuse timer', icon: '⏱️', hint: 'Counts down your own pressing time',
      ok: function () { return has('pressTimer'); }, open: openTimer },
    { id: 'glossary', label: 'Words in this pattern', icon: '📖', hint: 'Sewing terms the pattern uses, and its own key',
      ok: function (d) { return has('glossary') && !!(d.sourceText || d.steps.length); }, open: openGlossary },
    { id: 'fitting', label: 'Fitting log', icon: '📏', hint: 'Changes you made, carried to your next make',
      ok: function (d) { return has('addAlteration') && has('carryAlterations') && !isQuilt(d); }, open: openFitting }
  ];

  function ready() { return !!(Sw() && St() && typeof St().updateCraftData === 'function' && typeof Sw().normalize === 'function'); }

  function menuItems(project) {
    if (!ready()) return [];
    var p = projOf(project);
    if (!p || p.craft !== 'sewing') return [];
    var d;
    try { d = dataOf(p); } catch (e) { return []; }
    var out = [];
    ITEMS.forEach(function (it) {
      var ok = false;
      try { ok = it.ok(d); } catch (e) { ok = false; }
      if (ok) out.push({ id: it.id, label: it.label, icon: it.icon, hint: it.hint });
    });
    return out;
  }

  function open(id, project, opts) {
    opts = opts || {};
    if (!ready()) return false;
    var p = projOf(project);
    if (!p || p.craft !== 'sewing') return false;
    var it = null;
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) it = ITEMS[i];
    if (!it) return false;
    var d;
    try { d = dataOf(p); if (!it.ok(d)) return false; } catch (e) { return false; }
    if (opts.ctx) ctxNow = opts.ctx;
    try { it.open(p, opts); } catch (e) {
      if (window.console) console.error('SewingExtras.open(' + id + ')', e);
      return false;
    }
    return true;
  }

  window.SewingExtras = {
    version: VERSION,
    menuItems: menuItems,
    open: open,
    close: closeMine,
    /** QA: the open sheet's handles (timer). */
    __current: function () { return current; },
    /** QA: pure helpers the test page asserts. */
    __qa: { inchText: inchText, parseLength: parseLength, parsePair: parsePair, patternSystem: patternSystem, compare: compare, fmtTime: fmtTime, setCtx: function (c) { ctxNow = c; } }
  };
})();
