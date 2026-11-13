/* Thready or Not — js/app-xstitch-extras.js
 *
 * window.XStitchExtras: the self-contained cross-stitch sheets that open from
 * a project's "⋯" menu (wave K, xs-extras). The chart screen and the import
 * flows are js/app-xstitch.js (xs-app); this file never edits that one and
 * only calls what it publishes (docs/wave-k/api/xs-app.md), feature-detected.
 * Contract: docs/wave-k/api/xs-extras.md.
 *
 *   menuItems(project) -> [{ id, label, icon, hint }]
 *   open(id, project, { ctx, app, focus }) -> boolean
 *
 * Sheets (numbers from docs/wave-k/brainstorm/02-cross-stitch.md / 04):
 *   pace    #5 + #21 goals   stitching time, pace, ≈ finish range, goals
 *   fabric  #17              fabric, hoop and frame calculator
 *   kit     #15              floss stash across projects, kit list, shopping list
 *   brands  #16              other brands and substitutes (≈, never a silent swap)
 *   grow    X3               "Watch it grow" time-lapse (XSRender)
 *   framed  X4               framed finish picture through ShareCard
 *   print   #19              printable chart that knows the progress
 *   join    #18              join quadrant files, and the storage line
 *
 * Every number the app computes (rather than one printed in the pattern) is
 * shown with ≈ and only becomes a target when the stitcher taps "Use".
 * Everything runs on the device. ES5, no build step.
 */
(function () {
  'use strict';
  if (window.XStitchExtras && window.XStitchExtras.version >= 1) return;

  var CRAFT = 'crossstitch';
  var APPROX = '≈';
  var NO_DATE = 9e14;
  var DAY = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var FRAME_SIZES = [[5, 7], [8, 10], [11, 14], [12, 16], [16, 20]];

  /* ================================================================== *
   * 1. small helpers
   * ================================================================== */

  function X() { return window.XStitch || null; }
  function St() { return window.Store || null; }
  function R() { return window.XSRender || null; }
  function SC() { return window.ShareCard || null; }
  function fn(o, name) { return !!(o && typeof o[name] === 'function'); }
  function fns(o, names) {
    if (!o) return false;
    for (var i = 0; i < names.length; i++) if (typeof o[names[i]] !== 'function') return false;
    return true;
  }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function clampInt(v, lo, hi, d) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!isFinite(n)) return d;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }
  function fmtInt(n) {
    var x = X();
    if (fn(x, 'fmtInt')) return x.fmtInt(n);
    var s = String(Math.round(num(n, 0)));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function now() { return Date.now(); }
  /** "≈ 365" — every computed number goes through here. */
  function approx(text) { return APPROX + ' ' + text; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function on(node, type, f) { node.addEventListener(type, f); return node; }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function btn(cls, text, label) {
    var b = el('button', cls || 'btn', text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  function section(body, title, cls) {
    var s = el('section', 'xse-section' + (cls ? ' ' + cls : ''));
    if (title) {
      var h = el('h3', 'xse-h', title);
      s.appendChild(h);
    }
    body.appendChild(s);
    return s;
  }
  var fieldSeq = 0;
  function field(label, control, hint) {
    var f = el('div', 'field xse-field');
    fieldSeq++;
    var id = control.id || ('xse-f' + fieldSeq);
    var lab = el('label', null, label);
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) {
      control.id = id;
      lab.htmlFor = id;
      f.appendChild(lab);
    } else {
      lab = el('span', 'field-label', label);
      lab.id = id + '-l';
      control.setAttribute('aria-labelledby', lab.id);
      f.appendChild(lab);
    }
    f.appendChild(control);
    if (hint) {
      var h = el('p', 'field-hint', hint);
      h.id = id + '-h';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) control.setAttribute('aria-describedby', h.id);
      f.appendChild(h);
    }
    return f;
  }
  /** A row of toggle buttons (the shell's .seg look); onPick(id). */
  function seg(options, value, onPick) {
    var wrap = el('div', 'seg xse-seg');
    wrap.setAttribute('role', 'group');
    var buttons = [];
    options.forEach(function (o) {
      var b = btn(o.id === value ? 'on' : '', o.label);
      b.setAttribute('aria-pressed', o.id === value ? 'true' : 'false');
      b.setAttribute('data-id', o.id);
      if (o.disabled) b.disabled = true;
      on(b, 'click', function () {
        buttons.forEach(function (q) {
          var me = q === b;
          q.className = me ? 'on' : '';
          q.setAttribute('aria-pressed', me ? 'true' : 'false');
        });
        onPick(o.id);
      });
      buttons.push(b);
      wrap.appendChild(b);
    });
    return wrap;
  }
  function checkRow(label, hint, value, onChange) {
    var row = el('label', 'xse-check');
    var box = el('input');
    box.type = 'checkbox';
    box.checked = !!value;
    on(box, 'change', function () { onChange(box.checked); });
    row.appendChild(box);
    var t = el('span', 'xse-check-text');
    t.appendChild(el('span', 'xse-check-label', label));
    if (hint) t.appendChild(el('span', 'xse-check-hint', hint));
    row.appendChild(t);
    return row;
  }
  function swatch(hex) {
    var s = el('span', 'xse-swatch');
    s.setAttribute('aria-hidden', 'true');
    s.style.background = '#' + String(hex || '808080').replace(/^#/, '');
    return s;
  }
  function bar(pct, label) {
    var b = el('div', 'xse-bar');
    b.setAttribute('role', 'progressbar');
    b.setAttribute('aria-valuemin', '0');
    b.setAttribute('aria-valuemax', '100');
    b.setAttribute('aria-valuenow', String(clampInt(pct, 0, 100, 0)));
    if (label) b.setAttribute('aria-label', label);
    var f = el('span', 'xse-bar-fill');
    f.style.width = clampInt(pct, 0, 100, 0) + '%';
    b.appendChild(f);
    return b;
  }

  function fmtDate(ms) {
    var d = new Date(ms);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] +
      (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  }
  function fmtMonth(ms) { var d = new Date(ms); return MONTHS_LONG[d.getMonth()] + ' ' + d.getFullYear(); }
  function dateInputValue(ms) {
    var d = new Date(ms), m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  }
  function fromDateInput(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 0).getTime();
  }
  function daysAgoText(days) {
    if (days === null || days === undefined) return '';
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return days + ' days ago';
  }
  function bytesText(b) {
    if (!(b >= 0)) return '';
    if (b < 1024) return b + ' bytes';
    if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
    if (b < 1024 * 1024 * 1024) return round1(b / 1048576) + ' MB';
    return round1(b / 1073741824) + ' GB';
  }

  /* ---- units: the pattern's inches by default, a per-project switch ---- */

  /** parseLength('5 cm', 'in') -> { value: 5, unit: 'cm' }; a plain number takes `unit`. */
  function parseLength(text, unit) {
    var s = String(text == null ? '' : text).trim().toLowerCase().replace(',', '.');
    var m = /^(\d+(?:\.\d+)?|\.\d+)\s*(cm|mm|in|inch|inches|"|″|')?$/.exec(s);
    if (!m) return null;
    var v = parseFloat(m[1]), u = m[2] || unit || 'in';
    if (u === 'mm') { v = v / 10; u = 'cm'; }
    if (u === 'inch' || u === 'inches' || u === '"' || u === '″') u = 'in';
    if (u === "'") return null;
    if (!(v >= 0) || v > 200) return null;
    return { value: v, unit: u === 'cm' ? 'cm' : 'in' };
  }
  function toInches(len) { return len.unit === 'cm' ? len.value / 2.54 : len.value; }
  function toUnit(inches, unit) { return unit === 'cm' ? round1(inches * 2.54) : round2(inches); }
  function sizeText(wIn, hIn, unit) { return toUnit(wIn, unit) + ' × ' + toUnit(hIn, unit) + ' ' + unit; }
  function unitFor(projectId) {
    var S = St();
    try {
      var bag = S && fn(S, 'craftSettings') ? S.craftSettings(CRAFT) : null;
      var u = bag && isObj(bag.extrasUnits) ? bag.extrasUnits[projectId] : null;
      if (u === 'cm' || u === 'in') return u;
      var pr = S && fn(S, 'profile') ? S.profile() : null;
      if (pr && pr.units && (pr.units.length === 'cm' || pr.units.length === 'in')) return pr.units.length;
    } catch (e) { /* default */ }
    return 'in';
  }
  function setUnitFor(projectId, u) {
    var S = St();
    if (!S || !fn(S, 'craftSettings') || !fn(S, 'setCraftSetting')) return;
    var bag = S.craftSettings(CRAFT), map = isObj(bag.extrasUnits) ? JSON.parse(JSON.stringify(bag.extrasUnits)) : {};
    map[projectId] = u === 'cm' ? 'cm' : 'in';
    S.setCraftSetting(CRAFT, 'extrasUnits', map);
  }

  /* ================================================================== *
   * 2. projects and data
   * ================================================================== */

  var env = { ctx: null, app: null };

  function app() { return env.app || window.XStitchApp || null; }
  function live(p) {
    var S = St();
    var id = p && typeof p === 'object' ? p.id : p;
    var q = S && fn(S, 'project') && id ? S.project(id) : null;
    return q || (p && typeof p === 'object' ? p : null);
  }
  function dataOf(p) {
    var a = app();
    if (p && fn(a, 'dataOf')) {
      try { var d = a.dataOf(p); if (d) return d; } catch (e) { /* fall back */ }
    }
    var x = X();
    if (!p || !x) return null;
    var cd = p.craftData;
    if (isObj(cd) && cd.v === 1 && Array.isArray(cd.palette)) return cd;
    return x.normalize(cd, p);
  }
  function hasChart(d) { return !!(d && d.chart && d.chart.w > 0 && d.chart.h > 0); }
  function designSize(d) {
    if (!d) return null;
    if (hasChart(d)) return { w: d.chart.w, h: d.chart.h };
    if (d.design && d.design.w > 0 && d.design.h > 0) return { w: d.design.w, h: d.design.h };
    return null;
  }
  function isXs(p) { return !!p && (!p.craft || p.craft === CRAFT); }
  function paletteLabel(e) {
    if (!e) return '';
    var code = ((e.brand || 'DMC') + ' ' + (e.code || '')).trim();
    return e.name ? code + ' · ' + e.name : code;
  }
  function doneCount(d) {
    if (!d || !d.progress) return 0;
    return clampInt(d.progress.doneCount, 0, 1e9, 0);
  }
  function otherProjects(p) {
    var S = St();
    var list = S && fn(S, 'projects') ? S.projects() : [];
    return (Array.isArray(list) ? list : []).filter(function (q) { return q && q.id !== p.id && isXs(q) && q.craft === CRAFT; });
  }
  function notify(projectId, what) {
    var a = app();
    if (fn(a, 'repaint')) {
      try { a.repaint(projectId, { cells: what === 'fabric' }); } catch (e) { /* ignore */ }
    } else if (env.ctx && fn(env.ctx, 'render')) {
      try { env.ctx.render(); } catch (e2) { /* ignore */ }
    } else if (window.App && fn(window.App, 'render') && document.getElementById('app')) {
      try { window.App.render(); } catch (e3) { /* ignore */ }
    }
    fire('xse:changed', { projectId: projectId, what: what });
  }
  function fire(type, detail) {
    try {
      var ev;
      if (typeof window.CustomEvent === 'function') ev = new CustomEvent(type, { detail: detail });
      else { ev = document.createEvent('CustomEvent'); ev.initCustomEvent(type, false, false, detail); }
      document.dispatchEvent(ev);
    } catch (e) { /* ignore */ }
  }
  function toast(msg) {
    if (env.ctx && fn(env.ctx, 'toast')) { try { env.ctx.toast(msg); return; } catch (e) { /* fall back */ } }
    if (window.App && fn(window.App, 'toast') && document.getElementById('app')) { try { window.App.toast(msg); return; } catch (e2) { /* ignore */ } }
    if (current && current.say) current.say(msg);
  }

  /* ================================================================== *
   * 3. the sheet (the shell's when there is one, else our own <dialog>)
   * ================================================================== */

  var current = null;

  function ownSheet(conf) {
    var before = document.activeElement;
    var dlg = el('dialog', 'sheet ' + (conf.cls || ''));
    var inner = el('div', 'sheet-inner');
    var head = el('div', 'sheet-head');
    head.appendChild(el('div', 'sheet-grab'));
    var h = el('h2', 'sheet-title', conf.title);
    fieldSeq++;
    h.id = 'xse-title-' + fieldSeq;
    dlg.setAttribute('aria-labelledby', h.id);
    var x = btn('sheet-close', '✕', 'Close');
    head.appendChild(h);
    head.appendChild(x);
    var body = el('div', 'sheet-body');
    inner.appendChild(head);
    inner.appendChild(body);
    var done = false;
    var api = {
      dialog: dlg, body: body, title: h,
      close: function () {
        if (done) return;
        done = true;
        try { dlg.close(); } catch (e) { /* not open */ }
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
        if (conf.onClose) conf.onClose();
        try { if (before && before.focus && document.contains(before)) before.focus(); } catch (e2) { /* ignore */ }
      }
    };
    if (conf.footer && conf.footer.length) {
      var foot = el('div', 'sheet-foot');
      conf.footer.forEach(function (f) {
        var b = btn(f.cls || 'btn', f.text);
        on(b, 'click', function () { f.onClick(api); });
        foot.appendChild(b);
      });
      inner.appendChild(foot);
    }
    dlg.appendChild(inner);
    document.body.appendChild(dlg);
    on(x, 'click', function () { api.close(); });
    on(dlg, 'click', function (e) { if (e.target === dlg) api.close(); });
    on(dlg, 'cancel', function (e) { e.preventDefault(); api.close(); });
    on(dlg, 'close', function () { api.close(); });
    on(dlg, 'keydown', function (e) {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); api.close(); }
    });
    if (conf.build) conf.build(body, api);
    if (typeof dlg.showModal === 'function') {
      try { dlg.showModal(); } catch (e3) { dlg.setAttribute('open', ''); }
    } else {
      dlg.setAttribute('open', '');
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
    }
    // focus moves in to the close button, as the shell's sheets do (showModal),
    // so the sheet opens at its top rather than scrolled to a control
    try { x.focus(); } catch (e4) { /* ignore */ }
    return api;
  }

  /**
   * openSheet(id, project, title, build(body, rec), footer) -> rec
   * rec = { id, projectId, api, root, say(text), cleanup(fn), rebuild() }
   */
  function openSheet(id, p, title, build, footer) {
    if (current) closeCurrent();
    var rec = { id: id, projectId: p.id, api: null, root: null, cleanups: [] };
    rec.cleanup = function (f) { rec.cleanups.push(f); };
    rec.say = function (text) { if (rec.live) rec.live.textContent = text; };
    function doBuild(body, api) {
      rec.api = api;
      rec.root = body;
      body.classList.add('xse-body');
      rec.live = el('p', 'xse-live');
      rec.live.setAttribute('role', 'status');
      rec.live.setAttribute('aria-live', 'polite');
      build(body, rec);
      body.appendChild(rec.live);
    }
    rec.rebuild = function () {
      if (!rec.root) return;
      var keep = document.activeElement && rec.root.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
      var top = rec.root.scrollTop;
      rec.runCleanups();
      clear(rec.root);
      doBuild(rec.root, rec.api);
      rec.root.scrollTop = top;
      if (keep) {
        var n = rec.root.querySelector('[data-k="' + keep.replace(/"/g, '') + '"]');
        if (n) try { n.focus(); } catch (e) { /* ignore */ }
      }
    };
    rec.runCleanups = function () {
      var list = rec.cleanups;
      rec.cleanups = [];
      for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) { /* ignore */ } }
    };
    var conf = {
      title: title,
      cls: 'xse-sheet xse-sheet-' + id,
      subject: p.id,
      build: doBuild,
      footer: footer || [{ text: 'Close', cls: 'btn ghost', onClick: function (api) { api.close(); } }],
      onClose: function () {
        rec.runCleanups();
        if (current === rec) current = null;
        fire('xse:closed', { id: id });
      }
    };
    current = rec;
    if (env.ctx && fn(env.ctx, 'openSheet')) env.ctx.openSheet(conf);
    else ownSheet(conf);
    return rec;
  }
  function closeCurrent() {
    if (current && current.api) { try { current.api.close(); } catch (e) { /* ignore */ } }
    current = null;
  }

  /* ================================================================== *
   * 4. #5 + #21 — stitching time, pace, ≈ finish, goals
   * ================================================================== */

  var goalProbe = null;
  /** True when XStitch.normalize keeps craftData.goals (xs-core §0). */
  function craftKeepsGoals() {
    if (goalProbe !== null) return goalProbe;
    var x = X();
    try {
      var d = x.normalize({ goals: [{ id: 'g1', kind: 'total', createdAt: 1 }] }, null);
      goalProbe = !!(d && Array.isArray(d.goals) && d.goals.length === 1 && d.goals[0].kind === 'total');
    } catch (e) { goalProbe = false; }
    return goalProbe;
  }
  function decodeStoreGoal(g) {
    var lab = String(g.label || ''), m = /^xs:(perDay|total|page|colour)(?::(\d+))?$/.exec(lab);
    var out = { id: g.id, kind: g.kind === 'perDay' ? 'perDay' : 'total', createdAt: 0, store: true };
    if (m) out.kind = m[1];
    if (out.kind === 'perDay') out.n = g.n;
    if (out.kind === 'page') out.page = +m[2];
    if (out.kind === 'colour') out.color = +m[2];
    if (g.kind === 'byDate' && g.until && g.until < NO_DATE) out.by = g.until;
    return out;
  }
  /** goalStore(project): one place goals live (see docs/wave-k/api/xs-extras.md). */
  function goalStore(p) {
    var S = St(), inCraft = craftKeepsGoals();
    return {
      where: inCraft ? 'craftData' : (fn(S, 'setGoal') ? 'store' : 'none'),
      list: function () {
        var q = live(p);
        if (inCraft) { var d = dataOf(q); return d && Array.isArray(d.goals) ? d.goals.slice() : []; }
        return q && Array.isArray(q.goals) ? q.goals.map(decodeStoreGoal) : [];
      },
      add: function (goal) {
        var g = { id: 'g' + now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), kind: goal.kind, createdAt: now() };
        if (goal.kind === 'perDay') g.n = clampInt(goal.n, 1, 1e7, 100);
        if (goal.kind === 'page') g.page = clampInt(goal.page, 0, 9999, 0);
        if (goal.kind === 'colour') g.color = clampInt(goal.color, 0, 9999, 0);
        if (goal.by) g.by = goal.by;
        if (inCraft) {
          S.updateCraftData(p.id, function (cd) { cd.goals = (Array.isArray(cd.goals) ? cd.goals : []).concat([g]); });
          return g;
        }
        if (!fn(S, 'setGoal')) return null;
        var sg = g.kind === 'perDay'
          ? { id: g.id, kind: 'perDay', unit: 'stitch', n: g.n, label: 'xs:perDay' }
          : { id: g.id, kind: 'byDate', unit: 'stitch', until: g.by || NO_DATE,
            label: 'xs:' + g.kind + (g.kind === 'page' ? ':' + g.page : g.kind === 'colour' ? ':' + g.color : '') };
        return S.setGoal(p.id, sg) ? g : null;
      },
      remove: function (goalId) {
        if (inCraft) {
          S.updateCraftData(p.id, function (cd) {
            cd.goals = (Array.isArray(cd.goals) ? cd.goals : []).filter(function (g) { return g.id !== goalId; });
          });
          return true;
        }
        return fn(S, 'removeGoal') ? S.removeGoal(p.id, goalId) : false;
      }
    };
  }
  function goalTitle(g, d) {
    var pages = d && Array.isArray(d.pages) ? d.pages : [];
    var t = g.kind === 'perDay' ? fmtInt(g.n) + ' ' + plural(g.n, 'stitch', 'stitches') + ' a day'
      : g.kind === 'page' ? 'Finish ' + (pages[g.page] ? pages[g.page].label : 'page ' + (g.page + 1))
        : g.kind === 'colour' ? 'Finish ' + paletteLabel(d && d.palette ? d.palette[g.color] : null)
          : 'Finish the piece';
    if (g.by) t += ' by ' + fmtDate(g.by);
    return t;
  }

  function buildPace(body, rec, p, opts) {
    var S = St(), x = X(), q = live(p), d = dataOf(q);
    var act = fn(S, 'activity') ? S.activity(q.id) : { sessions: [], days: {}, total: {} };
    var tt = d ? x.totals(d) : { done: 0, total: 0 };
    var remaining = Math.max(0, tt.total - tt.done);
    var pc = fn(S, 'pace') ? S.pace(q.id, { unit: 'stitch', remaining: remaining }) : null;
    var strip = fn(x, 'dayStrip') ? x.dayStrip(act, 7, now()) : [];
    var week = 0;
    strip.forEach(function (s) { week += s.n; });

    var stats = el('div', 'xse-stats');
    function stat(cap, big, sub) {
      var c = el('div', 'xse-stat');
      c.appendChild(el('span', 'xse-stat-cap', cap));
      c.appendChild(el('span', 'xse-stat-big', big));
      if (sub) c.appendChild(el('span', 'xse-stat-sub', sub));
      stats.appendChild(c);
      return c;
    }
    stat('Today', fmtInt(pc ? pc.today : 0), plural(pc ? pc.today : 0, 'stitch', 'stitches'));
    stat('This week', fmtInt(week), plural(week, 'stitch', 'stitches'));
    stat('Streak', pc && pc.streak ? String(pc.streak) : '0', pc && pc.streak === 1 ? 'day' : 'days in a row');
    stat('Pace', pc && pc.perHour ? approx(fmtInt(Math.round(pc.perHour))) : '–', pc && pc.perHour ? 'stitches an hour' : 'not enough yet');
    body.appendChild(stats);

    if (strip.length) {
      var max = 1;
      strip.forEach(function (s) { if (s.n > max) max = s.n; });
      var st = el('div', 'xse-strip');
      st.setAttribute('role', 'img');
      st.setAttribute('aria-label', 'Stitches each day, the last 7 days: ' +
        strip.map(function (s) { return s.label + ' ' + fmtInt(s.n); }).join(', '));
      strip.forEach(function (s) {
        var col = el('div', 'xse-strip-day');
        var b = el('span', 'xse-strip-bar' + (s.n ? '' : ' empty'));
        b.style.height = (s.n ? Math.max(6, Math.round(s.n / max * 100)) : 2) + '%';
        col.appendChild(el('span', 'xse-strip-n', s.n ? fmtInt(s.n) : ''));
        var well = el('span', 'xse-strip-well');
        well.appendChild(b);
        col.appendChild(well);
        col.appendChild(el('span', 'xse-strip-label', s.label));
        st.appendChild(col);
      });
      body.appendChild(st);
    }

    var fin = section(body, 'When will it be done?', 'xse-finish');
    if (!tt.total) {
      fin.appendChild(el('p', 'muted', 'The chart has no stitches to count yet.'));
    } else if (!remaining) {
      fin.appendChild(el('p', 'xse-big-line', 'Every stitch is marked. Well done!'));
    } else if (pc && pc.finish) {
      var lo = fmtMonth(pc.finish.low), hi = fmtMonth(pc.finish.high);
      fin.appendChild(el('p', 'xse-big-line', approx(lo === hi ? 'around ' + lo : 'between ' + lo + ' and ' + hi)));
      fin.appendChild(el('p', 'muted', 'At your pace so far, with ' + fmtInt(remaining) + ' ' + plural(remaining, 'stitch', 'stitches') +
        ' to go. An estimate from your sessions, not a promise.'));
    } else {
      var n = pc ? pc.sessions : 0;
      fin.appendChild(el('p', 'muted', fmtInt(remaining) + ' ' + plural(remaining, 'stitch', 'stitches') + ' to go. ' +
        'A finish estimate appears after 5 stitching sessions (' + n + ' so far).'));
    }
    if (pc && pc.perDay) {
      fin.appendChild(el('p', 'muted', approx(fmtInt(Math.round(pc.perDay))) + ' stitches a day on the days you stitch.'));
    }
    if (pc && pc.lastAt) fin.appendChild(el('p', 'muted', 'Last stitched ' + daysAgoText(pc.daysSinceLast) + '.'));

    /* goals */
    var gs = goalStore(q);
    var gsec = section(body, 'Goals', 'xse-goals');
    gsec.id = 'xse-goals';
    if (gs.where === 'none') {
      gsec.appendChild(el('p', 'muted', 'Goals need a newer version of the app’s storage.'));
    } else {
      var goals = gs.list();
      var perDayN = {};
      goals.forEach(function (g) { if (g.kind === 'perDay') perDayN[g.n] = 1; });
      if (!goals.length) gsec.appendChild(el('p', 'muted', 'No goals yet. A goal can be a number of stitches a day, a page, a colour or the whole piece, with a date if you like.'));
      var ul = el('ul', 'xse-goal-list');
      goals.forEach(function (g) {
        var gp = x.goalProgress(g, d, act, now());
        var li = el('li', 'xse-goal' + (gp.met ? ' met' : ''));
        li.appendChild(el('span', 'xse-goal-title', goalTitle(g, d)));
        li.appendChild(bar(gp.pct, goalTitle(g, d)));
        li.appendChild(el('span', 'xse-goal-text', gp.text));
        var row = el('div', 'xse-row');
        if (gp.perDayNeeded && !perDayN[gp.perDayNeeded]) {
          var use = btn('btn small', 'Use ' + APPROX + ' ' + fmtInt(gp.perDayNeeded) + ' a day as a daily goal');
          use.setAttribute('data-k', 'use-' + g.id);
          on(use, 'click', function () {
            gs.add({ kind: 'perDay', n: gp.perDayNeeded });
            notify(q.id, 'goals');
            rec.rebuild();
            rec.say('Daily goal of ' + fmtInt(gp.perDayNeeded) + ' stitches added.');
          });
          row.appendChild(use);
        }
        var rm = btn('btn small ghost', 'Remove', 'Remove the goal ' + goalTitle(g, d));
        rm.setAttribute('data-k', 'rm-' + g.id);
        on(rm, 'click', function () {
          gs.remove(g.id);
          notify(q.id, 'goals');
          rec.rebuild();
          rec.say('Goal removed. Undo puts it back.');
        });
        row.appendChild(rm);
        li.appendChild(row);
        ul.appendChild(li);
      });
      if (goals.length) gsec.appendChild(ul);
      gsec.appendChild(goalForm(q, d, gs, rec));
    }

    /* history */
    var hsec = section(body, 'Sessions', 'xse-history');
    var lines = fn(x, 'sessionLines') ? x.sessionLines(act) : [];
    if (!lines.length) {
      hsec.appendChild(el('p', 'muted', 'No sessions yet. They are recorded as you mark stitches; a new one starts after 10 minutes away.'));
    } else {
      var hl = el('ul', 'xse-session-list');
      lines.slice(0, 12).forEach(function (s) { hl.appendChild(el('li', null, s.text)); });
      hsec.appendChild(hl);
      if (lines.length > 12) hsec.appendChild(el('p', 'muted', 'and ' + (lines.length - 12) + ' earlier ' + plural(lines.length - 12, 'session') + '.'));
    }
    if (opts && opts.focus === 'goals') {
      window.setTimeout(function () { try { gsec.scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ } }, 0);
    }
  }

  function goalForm(q, d, gs, rec) {
    var x = X();
    var pages = d && hasChart(d) && fn(x, 'pageProgress') ? x.pageProgress(d) : [];
    var cols = [];
    if (d && Array.isArray(d.palette)) {
      var stats = hasChart(d) && fn(x, 'progressStats') ? x.progressStats(d) : null;
      d.palette.forEach(function (e, i) {
        if (e.unresolved || (e.kind && e.kind !== 'cross' && e.kind !== 'half' && e.kind !== 'blend')) return;
        var bc = stats && stats.byColor[i];
        if (bc && bc.total > 0) cols.push({ i: i, label: paletteLabel(e) + ' · ' + fmtInt(bc.total - bc.done) + ' left' });
      });
    }
    var draft = { kind: 'perDay', n: 200, page: pages.length ? pages[0].page : 0, color: cols.length ? cols[0].i : 0, by: null };
    var box = el('div', 'xse-goal-form card');
    box.appendChild(el('h4', 'xse-h4', 'Add a goal'));
    var kinds = [{ id: 'perDay', label: 'Per day' }, { id: 'page', label: 'A page', disabled: !pages.length },
      { id: 'colour', label: 'A colour', disabled: !cols.length }, { id: 'total', label: 'The piece', disabled: !hasChart(d) }];
    var fields = el('div', 'xse-goal-fields');
    box.appendChild(field('Goal', seg(kinds, draft.kind, function (v) { draft.kind = v; paint(); })));
    box.appendChild(fields);
    var add = btn('btn primary small', 'Add goal');
    add.setAttribute('data-k', 'add-goal');
    function paint() {
      clear(fields);
      if (draft.kind === 'perDay') {
        var n = el('input', 'xse-num');
        n.type = 'number'; n.min = '1'; n.max = '100000'; n.inputMode = 'numeric'; n.value = String(draft.n);
        on(n, 'input', function () { draft.n = clampInt(n.value, 1, 1e7, 0); });
        fields.appendChild(field('Stitches a day', n));
        return;
      }
      if (draft.kind === 'page') {
        var sp = el('select');
        pages.forEach(function (pg) {
          var o = el('option', null, pg.label + ' · ' + pg.pctText + (pg.complete ? ' ✓' : ''));
          o.value = String(pg.page);
          sp.appendChild(o);
        });
        sp.value = String(draft.page);
        on(sp, 'change', function () { draft.page = +sp.value; });
        fields.appendChild(field('Page', sp));
      }
      if (draft.kind === 'colour') {
        var sc = el('select');
        cols.forEach(function (c) { var o = el('option', null, c.label); o.value = String(c.i); sc.appendChild(o); });
        sc.value = String(draft.color);
        on(sc, 'change', function () { draft.color = +sc.value; });
        fields.appendChild(field('Colour', sc));
      }
      var dt = el('input');
      dt.type = 'date';
      dt.min = dateInputValue(now());
      if (draft.by) dt.value = dateInputValue(draft.by);
      on(dt, 'change', function () { draft.by = fromDateInput(dt.value); });
      fields.appendChild(field('By (optional)', dt, 'With a date, the app works out ' + APPROX + ' how many a day that takes.'));
    }
    paint();
    on(add, 'click', function () {
      if (draft.kind === 'perDay' && !(draft.n >= 1)) { rec.say('Type how many stitches a day.'); return; }
      var g = gs.add(draft);
      if (!g) { rec.say('That goal could not be saved.'); return; }
      notify(q.id, 'goals');
      rec.rebuild();
      rec.say('Goal added: ' + goalTitle(g, d) + '.');
    });
    box.appendChild(add);
    return box;
  }

  /* ================================================================== *
   * 5. #17 — fabric, hoop and frame
   * ================================================================== */

  function buildFabric(body, rec, p) {
    var x = X(), q = live(p), d = dataOf(q), size = designSize(d);
    var st = { count: d.fabric.count, over: d.fabric.over, margin: 'frame', custom: null, unit: unitFor(q.id), frame: 1 };
    var out = el('div', 'xse-fabric-out');

    var top = el('div', 'xse-fabric-controls');
    var cnt = el('input', 'xse-num');
    cnt.type = 'number'; cnt.min = '6'; cnt.max = '40'; cnt.inputMode = 'numeric'; cnt.value = String(st.count);
    on(cnt, 'input', function () { var v = clampInt(cnt.value, 6, 40, null); if (v) { st.count = v; paint(); } });
    top.appendChild(field('Fabric count', cnt, 'Holes per inch: 14-count aida, 28-count linen…'));
    top.appendChild(checkRow('Stitched over two threads', 'Usual on linen and evenweave; halves the count.', st.over === 2,
      function (v) { st.over = v ? 2 : 1; paint(); }));
    var customBox = el('div', 'xse-custom');
    var mIn = el('input', 'xse-num');
    mIn.type = 'text'; mIn.inputMode = 'decimal'; mIn.placeholder = st.unit === 'cm' ? '5 cm' : '2 in';
    on(mIn, 'input', function () {
      var len = parseLength(mIn.value, st.unit);
      st.custom = len ? toInches(len) : null;
      paint();
    });
    customBox.appendChild(field('Margin on each side', mIn, 'A number in ' + (st.unit === 'cm' ? 'cm' : 'inches') + ', or add “cm” or “in”.'));
    customBox.hidden = true;
    top.appendChild(field('Margin', seg([{ id: 'frame', label: 'For framing' }, { id: 'hoop', label: 'For a hoop' },
      { id: 'custom', label: 'My own' }], st.margin, function (v) { st.margin = v; customBox.hidden = v !== 'custom'; paint(); })));
    top.appendChild(customBox);
    top.appendChild(field('Show sizes in', seg([{ id: 'in', label: 'inches' }, { id: 'cm', label: 'cm' }], st.unit, function (v) {
      st.unit = v;
      setUnitFor(q.id, v);
      mIn.placeholder = v === 'cm' ? '5 cm' : '2 in';
      paint();
    }), 'Remembered for this project. Either unit can be typed anywhere.'));
    body.appendChild(top);
    body.appendChild(out);

    var rev = section(body, 'Will it fit my frame?', 'xse-reverse');
    rev.appendChild(field('Frame or hoop opening', seg(FRAME_SIZES.map(function (f, i) {
      return { id: String(i), label: f[0] + ' × ' + f[1] + ' in' };
    }), String(st.frame), function (v) { st.frame = +v; paintReverse(); })));
    var revOut = el('ul', 'xse-fit-list');
    rev.appendChild(revOut);

    function paint() {
      clear(out);
      if (!size) { out.appendChild(el('p', 'muted', 'Set the design size (in stitches) in Fabric & size first.')); return; }
      var margin = st.margin === 'custom' ? (st.custom === null ? 3 : st.custom) : st.margin;
      var plan = x.fabricPlan({ w: size.w, h: size.h, count: st.count, over: st.over, margin: margin });
      var u = st.unit;
      var card = el('div', 'card xse-plan');
      card.appendChild(el('p', 'xse-plan-label', 'Stitched size'));
      card.appendChild(el('p', 'xse-big-line', approx(sizeText(plan.design.wIn, plan.design.hIn, u))));
      card.appendChild(el('p', 'muted', size.w + ' × ' + size.h + ' stitches on ' + st.count + '-count' + (st.over === 2 ? ' over two' : '') + '.'));
      card.appendChild(el('p', 'xse-plan-label', 'Cut the fabric'));
      card.appendChild(el('p', 'xse-big-line', approx(sizeText(plan.cut.wIn, plan.cut.hIn, u))));
      card.appendChild(el('p', 'muted', 'With ' + toUnit(plan.margin.in, u) + ' ' + u + ' spare on each side.'));
      out.appendChild(card);

      var ul = el('ul', 'xse-fit-list');
      plan.cuts.forEach(function (c) {
        var li = el('li', c.fits ? 'fits' : 'no');
        li.appendChild(el('span', 'xse-fit-mark', c.fits ? '✓' : '✕'));
        li.appendChild(el('span', null, cap(c.name) + ' (' + sizeText(c.w, c.h, u) + '): ' +
          (c.fits ? 'fits, ' + approx(toUnit(c.spareIn, u) + ' ' + u) + ' to spare' : 'too small')));
        ul.appendChild(li);
      });
      section(out, 'Will a standard piece do?', 'xse-cuts').appendChild(ul);

      var hs = el('div', 'card xse-plan');
      hs.appendChild(el('p', 'xse-plan-label', 'Hoop, Q-snap and frame'));
      hs.appendChild(el('p', null, plan.hoop
        ? 'A ' + (u === 'cm' ? plan.hoop.cm + ' cm (' + plan.hoop.in + ' in)' : plan.hoop.in + ' in') + ' hoop holds the whole design.'
        : 'Bigger than a 14 in hoop: use a scroll frame or move the hoop as you go.'));
      if (plan.qsnap) hs.appendChild(el('p', null, 'Q-snap: ' + sizeText(plan.qsnap.wIn, plan.qsnap.hIn, u) + '.'));
      if (plan.frame) {
        hs.appendChild(el('p', null, 'Frame: ' + plan.frame.wIn + ' × ' + plan.frame.hIn + ' in, with a mat opening of ' +
          approx(sizeText(plan.frame.opening.w, plan.frame.opening.h, u)) + '.'));
      } else {
        hs.appendChild(el('p', null, 'Larger than a 24 × 36 in frame: a framer will make one to size.'));
      }
      out.appendChild(hs);

      if (st.count !== d.fabric.count || st.over !== d.fabric.over) {
        var use = btn('btn primary small', 'Use ' + st.count + '-count' + (st.over === 2 ? ' over two' : '') + ' for this project');
        use.setAttribute('data-k', 'use-count');
        on(use, 'click', function () {
          St().updateCraftData(q.id, function (cd) {
            cd.fabric.count = st.count; cd.fabric.countY = st.count; cd.fabric.over = st.over;
            if (st.over === 2 && cd.fabric.kind === 'aida') cd.fabric.kind = 'evenweave';
          });
          d = dataOf(live(q));
          notify(q.id, 'fabric');
          rec.say('This project now uses ' + st.count + '-count fabric.');
          paint();
        });
        out.appendChild(use);
      }
      paintReverse();
    }
    function paintReverse() {
      clear(revOut);
      if (!size) return;
      var f = FRAME_SIZES[st.frame] || FRAME_SIZES[1];
      x.frameFit({ w: size.w, h: size.h, over: st.over }, { wIn: f[0], hIn: f[1] }, [11, 14, 16, 18, 20, 22, 25, 28, 32]).forEach(function (r) {
        var li = el('li', r.fits ? 'fits' : 'no');
        li.appendChild(el('span', 'xse-fit-mark', r.fits ? '✓' : '✕'));
        li.appendChild(el('span', null, r.count + '-count' + (st.over === 2 ? ' over two' : '') + ': ' +
          approx(sizeText(r.wIn, r.hIn, st.unit)) + (r.fits ? ', fits' : ', too big')));
        revOut.appendChild(li);
      });
    }
    paint();
    rec.paint = paint;
    rec.state = st;
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ================================================================== *
   * 6. #15 — one floss stash, a kit list and a shopping list
   * ================================================================== */

  function kitFor(p, opts) {
    var x = X(), S = St(), q = live(p);
    var others = otherProjects(q).filter(function (o) { return o.status !== 'finished' && o.status !== 'frogged'; });
    others.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var me = { id: q.id, title: q.name || 'This project', data: dataOf(q) };
    var list = others.map(function (o) { return { id: o.id, title: o.name || 'Untitled', data: dataOf(o) }; });
    list = opts.first ? [me].concat(list) : list.concat([me]);
    var stash = fn(S, 'profile') ? S.profile().floss : {};
    var kit = x.kitList(list, stash, { remaining: opts.remaining });
    var mine = null, names = {};
    kit.projects.forEach(function (k) { names[k.id] = k.title; if (k.id === q.id) mine = k; });
    return { kit: kit, mine: mine, names: names, data: me.data };
  }
  function shoppingText(kitProject, title) {
    var rows = kitProject ? kitProject.rows.filter(function (r) { return r.buy > 0; }) : [];
    var name = title || (kitProject && kitProject.title) || 'my project';
    if (!rows.length) return 'Nothing to buy: the floss you have covers ' + name + '.';
    var lines = ['Floss to buy for ' + name + ' (' + APPROX + ' skeins, estimated from the chart):'];
    rows.forEach(function (r) {
      lines.push('- ' + r.brand + ' ' + (r.shown || r.code) + (r.name ? ' ' + r.name : '') + ': ' + r.buy + ' ' + plural(r.buy, 'skein'));
    });
    var total = 0;
    rows.forEach(function (r) { total += r.buy; });
    lines.push(APPROX + ' ' + total + ' ' + plural(total, 'skein') + ' in all.');
    return lines.join('\n');
  }

  function buildKit(body, rec, p, opts) {
    var S = St(), q = live(p);
    var st = rec.kitState || (rec.kitState = { remaining: true, first: false });
    var k = kitFor(q, st);
    var hexOf = {}, codeOf = {};
    (k.data.palette || []).forEach(function (e) {
      var id = X().flossId(e.brand || 'DMC', e.code);
      if (id && !hexOf[id]) hexOf[id] = e.hex;
      /* the code as the chart prints it (B5200, not the lookup key b5200) */
      if (id && !codeOf[id] && e.code) codeOf[id] = String(e.code);
    });
    var others = Object.keys(k.names).length - 1;
    body.appendChild(el('p', 'muted', 'What this chart needs against the floss you own. Your floss is one list for every project' +
      (others === 1 ? '; your other cross-stitch project takes its share first unless you change that below.'
        : others > 1 ? '; your ' + others + ' other cross-stitch projects take their share first unless you change that below.' : '.')));
    var opt = el('div', 'xse-opts');
    opt.appendChild(checkRow('Only what is left to stitch', 'Skip the floss for stitches already marked.', st.remaining,
      function (v) { st.remaining = v; rec.rebuild(); }));
    if (others > 0) {
      opt.appendChild(checkRow('This project gets first pick', 'Otherwise your other projects keep what they need.', st.first,
        function (v) { st.first = v; rec.rebuild(); }));
    }
    body.appendChild(opt);
    var rows = k.mine ? k.mine.rows : [];
    rows.forEach(function (r) { r.shown = codeOf[r.id] || r.code; });
    if (!rows.length) {
      body.appendChild(el('p', 'muted', 'There are no floss codes to count in this chart yet.'));
      return;
    }
    var buy = k.mine.buy;
    body.appendChild(el('p', 'xse-big-line', buy ? 'Buy ' + approx(buy + ' ' + plural(buy, 'skein')) : 'Your stash covers this project ✓'));
    body.appendChild(el('p', 'muted', 'Skein counts are estimates from the chart, with a little spare (' + APPROX + ').'));
    var ul = el('ul', 'xse-kit-list');
    var focus = opts && isObj(opts.focus) ? X().flossId(opts.focus.brand || 'DMC', opts.focus.code) : null;
    rows.forEach(function (r) {
      var li = el('li', 'xse-kit-row' + (r.buy ? ' buy' : ' ok') + (focus === r.id ? ' focus' : ''));
      li.appendChild(swatch(hexOf[r.id]));
      var mid = el('div', 'xse-kit-mid');
      mid.appendChild(el('span', 'xse-kit-name', r.brand + ' ' + (r.shown || r.code) + (r.name ? ' · ' + r.name : '')));
      var owned = fn(S, 'flossOwned') ? S.flossOwned(r.brand, r.code) : 0;
      var parts = ['need ' + approx(r.need), 'you have ' + fmtInt(owned)];
      var aside = r.setAside.filter(function (s) { return s.n > 0; });
      if (aside.length) {
        parts.push(aside.map(function (s) { return s.n + ' set aside for ' + (k.names[s.id] || 'another project'); }).join(', '));
      }
      mid.appendChild(el('span', 'xse-kit-detail', parts.join(' · ')));
      li.appendChild(mid);
      li.appendChild(el('span', 'xse-kit-buy', r.buy ? 'buy ' + r.buy : '✓'));
      var step = el('div', 'xse-stepper');
      step.setAttribute('role', 'group');
      step.setAttribute('aria-label', 'Skeins of ' + r.brand + ' ' + r.code + ' you own');
      var minus = btn('btn small ghost', '−', 'One fewer skein of ' + r.brand + ' ' + r.code);
      var plus = btn('btn small ghost', '+', 'One more skein of ' + r.brand + ' ' + r.code);
      minus.setAttribute('data-k', 'm-' + r.id);
      plus.setAttribute('data-k', 'p-' + r.id);
      minus.disabled = !owned;
      function change(delta) {
        if (!fn(S, 'adjustFloss')) return;
        var n = S.adjustFloss(r.brand.toLowerCase(), r.code, delta);
        fire('xse:changed', { projectId: q.id, what: 'stash' });
        rec.rebuild();
        rec.say(r.brand + ' ' + r.code + ': you have ' + n + '.');
      }
      on(minus, 'click', function () { change(-1); });
      on(plus, 'click', function () { change(1); });
      step.appendChild(minus);
      step.appendChild(plus);
      li.appendChild(step);
      ul.appendChild(li);
    });
    body.appendChild(ul);

    var text = shoppingText(k.mine, q.name);
    var sh = section(body, 'Shopping list', 'xse-shop');
    var ta = el('textarea', 'xse-copy');
    ta.readOnly = true;
    ta.rows = Math.min(10, text.split('\n').length + 1);
    ta.value = text;
    sh.appendChild(field('To copy or share', ta));
    var row = el('div', 'xse-row');
    var copy = btn('btn small', '📋 Copy list');
    copy.setAttribute('data-k', 'copy');
    on(copy, 'click', function () {
      var okFn = function () { rec.say('Shopping list copied.'); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(okFn, function () { ta.focus(); ta.select(); rec.say('Select the text and copy it.'); });
          return;
        }
      } catch (e) { /* fall through */ }
      ta.focus(); ta.select();
      try { if (document.execCommand('copy')) { okFn(); return; } } catch (e2) { /* ignore */ }
      rec.say('Select the text and copy it.');
    });
    row.appendChild(copy);
    if (navigator.share) {
      var share = btn('btn small', '📤 Share list');
      on(share, 'click', function () {
        try { navigator.share({ title: 'Floss to buy', text: text }).then(null, function () { /* cancelled */ }); } catch (e) { /* ignore */ }
      });
      row.appendChild(share);
    }
    sh.appendChild(row);
    rec.kit = k;
  }

  /* ================================================================== *
   * 7. #16 — other brands and substitutes
   * ================================================================== */

  function buildBrands(body, rec, p, opts) {
    var x = X(), S = St(), q = live(p), d = dataOf(q);
    var tables = x.brandTables();
    var list = el('p', 'muted', 'Colour lists on this device: ' + tables.map(function (t) {
      return t.brand + ' (' + fmtInt(t.n) + ' colours' + (t.provenance && t.provenance.licence ? ', ' + t.provenance.licence : '') + ')';
    }).join('; ') + '.');
    body.appendChild(list);
    if (tables.length < 2) {
      body.appendChild(el('p', 'xse-note', 'Only the DMC list is here. Other brands need a colour list we are allowed to use, ' +
        'so the app does not guess Anchor or Madeira matches yet. Your stash can still stand in for a colour you are out of.'));
    }
    body.appendChild(el('p', 'muted', 'Matches are by colour, measured on screen: ' + APPROX + ' always. Check them against real thread. ' +
      'Nothing on the chart changes here.'));
    var stash = fn(S, 'profile') ? S.profile().floss : {};
    var anyStash = Object.keys(stash || {}).length > 0;
    var ul = el('ul', 'xse-brand-list');
    var openIdx = opts && isObj(opts.focus) && typeof opts.focus.index === 'number' ? opts.focus.index : -1;
    (d.palette || []).forEach(function (e, i) {
      if (e.unresolved || !e.code) return;
      var brand = e.brand || 'DMC';
      var li = el('li', 'xse-brand-row');
      var head = el('div', 'xse-brand-head');
      head.appendChild(swatch(e.hex));
      head.appendChild(el('span', 'xse-kit-name', paletteLabel(e)));
      li.appendChild(head);
      var conv = el('div', 'xse-brand-conv');
      tables.forEach(function (t) {
        if (t.brand.toLowerCase() === brand.toLowerCase()) return;
        var r = x.convert(brand, e.code, t.brand);
        conv.appendChild(el('p', r.none ? 'muted' : null, r.none ? r.reason
          : 'As ' + t.brand + ': ' + r.code + (r.name ? ' ' + r.name : '') + ' · ' + APPROX + ' ' + r.word + ' match'));
      });
      if (conv.firstChild) li.appendChild(conv);
      var out = el('div', 'xse-subs');
      out.hidden = true;
      var b = btn('btn small ghost', 'I am out of this', 'I am out of ' + paletteLabel(e) + ': show substitutes from my stash');
      b.setAttribute('aria-expanded', 'false');
      b.setAttribute('data-k', 'out-' + i);
      function show() {
        clear(out);
        var subs = x.substitutes(brand, e.code, stash, 3);
        if (!subs.length) {
          out.appendChild(el('p', 'muted', anyStash ? 'Nothing in your stash is close to this colour.'
            : 'Add the floss you own in Floss stash and kit list to see substitutes here.'));
        } else {
          var sl = el('ul', 'xse-sub-list');
          subs.forEach(function (s) {
            var si = el('li');
            si.appendChild(swatch(s.hex));
            si.appendChild(el('span', null, s.brand + ' ' + s.code + (s.name ? ' ' + s.name : '') + ' · ' + APPROX + ' ' + s.word +
              ' match · you have ' + s.have));
            sl.appendChild(si);
          });
          out.appendChild(sl);
          out.appendChild(el('p', 'muted', 'Suggestions only: the chart keeps ' + brand + ' ' + e.code + '.'));
        }
        out.hidden = false;
        b.setAttribute('aria-expanded', 'true');
      }
      on(b, 'click', function () {
        if (!out.hidden) { out.hidden = true; b.setAttribute('aria-expanded', 'false'); return; }
        show();
      });
      li.appendChild(b);
      li.appendChild(out);
      ul.appendChild(li);
      if (i === openIdx) show();
    });
    body.appendChild(ul);
  }

  /* ================================================================== *
   * 8. X3 — Watch it grow
   * ================================================================== */

  /**
   * orderFromChunks(chunks, n) -> { order:Int32Array, at:Float64Array } | null
   * Store.readMarks chunks ([{ at, marks:[[i, 1|0]] }]) flattened to the marks
   * that set a stitch, oldest first, with each one's chunk time.
   */
  function orderFromChunks(chunks, n) {
    if (!Array.isArray(chunks) || !chunks.length) return null;
    var idx = [], at = [];
    for (var c = 0; c < chunks.length; c++) {
      var ch = chunks[c], marks = ch && Array.isArray(ch.marks) ? ch.marks : [];
      for (var k = 0; k < marks.length; k++) {
        var m = marks[k];
        if (!m || !m[1]) continue;
        var i = m[0];
        if (typeof i !== 'number' || i < 0 || i >= n) continue;
        idx.push(i);
        at.push(num(ch.at, 0));
      }
    }
    if (!idx.length) return null;
    return { order: new Int32Array(idx), at: at };
  }
  /** The date shown at time-lapse position f: the chunk time of the cell revealed there. */
  function dateAt(info, f) {
    if (!info || !info.atByRank || !info.atByRank.length) return null;
    var r = R(), total = info.total;
    var shown = r && fn(r, 'revealCount') ? r.revealCount(f, total) : Math.round(f * total);
    var k = shown - info.before - 1;
    if (k < 0) return info.before ? 'before the app kept a record' : null;
    var t = info.atByRank[Math.min(info.atByRank.length - 1, k)];
    return t ? fmtDate(t) : null;
  }
  function rankTimes(flat, d) {
    /* replayOrder's rule: the last time a cell was set wins, and only cells
       still done count; the rest show from the first frame. */
    var x = X(), n = d.chart.w * d.chart.h, bits = null;
    if (fn(x, 'bitsState')) bits = x.bitsState(d.progress.done || '', n);
    var last = {};
    for (var i = 0; i < flat.order.length; i++) last[flat.order[i]] = i;
    var at = [];
    for (i = 0; i < flat.order.length; i++) {
      var c = flat.order[i];
      if (last[c] !== i) continue;
      if (bits && fn(x, 'getBit') && !x.getBit(bits, c)) continue;
      at.push(flat.at[i]);
    }
    return at;
  }
  function saveBlob(blob, filename, title) {
    var sc = SC();
    if (sc && fn(sc, 'share')) return sc.share(blob, { filename: filename, title: title, text: title });
    try {
      var url = URL.createObjectURL(blob), a = el('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      return Promise.resolve('downloaded');
    } catch (e) { return Promise.resolve('failed'); }
  }
  function slug(s) { return (String(s || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart').slice(0, 40); }
  function reduceMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function buildGrow(body, rec, p) {
    var r = R(), S = St(), q = live(p), d = dataOf(q);
    var notice = el('p', 'xse-note');
    notice.textContent = 'Getting the replay ready…';
    var wrap = el('div', 'xse-canvas-wrap');
    var ratio = Math.max(0.5, Math.min(2, d.chart.h / d.chart.w));
    wrap.style.aspectRatio = '1 / ' + round2(ratio);
    var canvas = el('canvas', 'xse-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The piece filling in, stitch by stitch');
    wrap.appendChild(canvas);
    body.appendChild(notice);
    body.appendChild(wrap);
    var status = el('p', 'muted xse-status');
    body.appendChild(status);
    var ctrl = el('div', 'xse-player');
    var play = btn('btn primary small', '▶ Play');
    play.setAttribute('data-k', 'play');
    var range = el('input', 'xse-range');
    range.type = 'range'; range.min = '0'; range.max = '1000'; range.step = '1'; range.value = '0';
    range.setAttribute('aria-label', 'Position in the replay');
    var when = el('span', 'xse-when muted');
    ctrl.appendChild(play);
    ctrl.appendChild(range);
    body.appendChild(ctrl);
    body.appendChild(when);
    var saves = el('div', 'xse-row');
    var savePic = btn('btn small', '📥 Save this frame');
    saves.appendChild(savePic);
    var vidOk = fn(r, 'canRecordVideo') ? r.canRecordVideo() : { ok: false };
    var saveVid = null;
    if (vidOk && vidOk.ok) {
      saveVid = btn('btn small', '🎞️ Save a video');
      saves.appendChild(saveVid);
    } else {
      saves.appendChild(el('span', 'muted xse-small', 'Saving a video is not supported on this device; save a frame instead.'));
    }
    body.appendChild(saves);
    var handle = null, tl = null, info = null, busy = false;
    play.disabled = true; range.disabled = true; savePic.disabled = true;
    if (saveVid) saveVid.disabled = true;

    try {
      handle = r.mount(canvas, {
        view: 'fit', ghost: 0.12, background: 'theme', reducedMotion: reduceMotion(),
        onStatus: function (s) { if (s && s.message) status.textContent = s.message; }
      });
      handle.setModel(d);
      rec.handle = handle;
    } catch (e) {
      notice.textContent = 'The replay could not start on this device.';
      return;
    }
    rec.cleanup(function () {
      if (tl) { try { tl.destroy(); } catch (e) { /* ignore */ } }
      if (handle) { try { handle.destroy({ release: true }); } catch (e2) { /* ignore */ } }
      tl = null; handle = null;
    });
    window.setTimeout(function () { if (handle) try { handle.resize(); } catch (e) { /* ignore */ } }, 0);
    /* the first picture waits for the GPU (≈ 2 s on a cold start): say so */
    (function watchCompile(n) {
      var cs = null;
      try { cs = handle && fn(handle, 'getStats') ? handle.getStats() : null; } catch (e) { cs = null; }
      if (!handle || !cs) return;
      if (cs.compiling && n < 100) {
        if (!status.textContent) status.textContent = 'Getting the picture ready…';
        window.setTimeout(function () { watchCompile(n + 1); }, 100);
      } else if (status.textContent === 'Getting the picture ready…') {
        status.textContent = '';
      }
    })(0);

    var marks = fn(S, 'readMarks') ? S.readMarks(q.id) : Promise.resolve([]);
    Promise.resolve(marks).then(null, function () { return []; }).then(function (chunks) {
      if (!handle) return;
      var flat = orderFromChunks(chunks, d.chart.w * d.chart.h);
      tl = r.timelapse(handle, {
        order: flat ? flat.order : null, durationMs: 10000,
        onTick: function (f) {
          range.value = String(Math.round(f * 1000));
          var w = dateAt(info, f);
          when.textContent = w ? 'Showing ' + w : '';
        },
        onEnd: function () { play.textContent = '▶ Play again'; }
      });
      info = { total: tl.count, before: tl.before || 0, atByRank: !tl.fallback && flat ? rankTimes(flat, d) : null };
      rec.tl = tl;
      if (tl.fallback) {
        notice.textContent = (tl.label || 'Not your real order') + '. This project has no record of the order you stitched in, ' +
          'so this is a made-up order, not your history.';
        notice.classList.add('xse-warn');
      } else {
        notice.textContent = 'Your stitches in the order you marked them (' + fmtInt(tl.count) + ' in all)' +
          (tl.before ? ', with ' + fmtInt(tl.before) + ' marked before the app kept a record shown from the start.' : '.');
      }
      play.disabled = false; range.disabled = false; savePic.disabled = false;
      if (saveVid) saveVid.disabled = false;
      if (!reduceMotion()) { tl.play(); play.textContent = '⏸ Pause'; }
    });
    on(play, 'click', function () {
      if (!tl) return;
      if (tl.playing) { tl.pause(); play.textContent = '▶ Play'; return; }
      if (tl.position >= 1) tl.seek(0);
      tl.play();
      play.textContent = '⏸ Pause';
    });
    on(range, 'input', function () {
      if (!tl) return;
      if (tl.playing) { tl.pause(); play.textContent = '▶ Play'; }
      tl.seek(clampInt(range.value, 0, 1000, 0) / 1000);
    });
    on(savePic, 'click', function () {
      if (!tl || busy) return;
      tl.exportFrame().then(function (blob) {
        if (!blob) { rec.say('The picture could not be made.'); return; }
        return saveBlob(blob, 'thready-or-not-' + slug(q.name) + '-grow.png', q.name).then(function (res) {
          if (res === 'downloaded') rec.say('Picture saved.');
          else if (res === 'failed') rec.say('The picture could not be saved.');
        });
      }, function () { rec.say('The picture could not be made.'); });
    });
    if (saveVid) {
      on(saveVid, 'click', function () {
        if (!tl || busy) return;
        busy = true;
        saveVid.disabled = true;
        rec.say('Recording 6 seconds of video…');
        tl.recordVideo({ durationMs: 6000, fps: 30 }).then(function (res) {
          busy = false;
          if (saveVid) saveVid.disabled = false;
          if (!res || !res.ok) { rec.say((res && res.reason) || 'Saving a video is not supported on this device.'); return; }
          var ext = /mp4/.test(res.mime || '') ? 'mp4' : 'webm';
          return saveBlob(res.blob, 'thready-or-not-' + slug(q.name) + '-grow.' + ext, q.name).then(function (s) {
            rec.say(s === 'failed' ? 'The video could not be saved.' : 'Video ready.');
          });
        }, function () { busy = false; if (saveVid) saveVid.disabled = false; rec.say('The video could not be made.'); });
      });
    }
  }

  /* ================================================================== *
   * 9. X4 — framed finish and share picture (ShareCard)
   * ================================================================== */

  function pictureOf(q, size, frame) {
    var a = app();
    if (fn(a, 'picture')) {
      try { return Promise.resolve(a.picture(q, { size: size, frame: frame })); } catch (e) { /* fall back */ }
    }
    return R().picture(dataOf(q), { size: size, frame: frame, background: 'transparent', ghost: 0 });
  }
  function shareInfo(q, d, picture) {
    var x = X(), tt = x.totals(d);
    var kind = d.fabric.kind === 'aida' ? 'aida' : d.fabric.kind;
    return {
      name: q.name || 'Cross-stitch', emoji: q.emoji || '🪡',
      craft: { id: CRAFT, name: 'Cross-stitch', emoji: '🪡' },
      status: q.status, startedAt: q.createdAt, finishedAt: q.finishedAt,
      progress: q.status === 'finished' || (tt.total && tt.done >= tt.total) ? { text: 'Finished', pct: 1 }
        : { text: tt.pctText + ' · ' + fmtInt(tt.done) + ' of ' + fmtInt(tt.total) + ' stitches', pct: tt.total ? tt.done / tt.total : 0 },
      lines: [d.fabric.count + '-count ' + kind + (d.chart ? ' · ' + d.chart.w + ' × ' + d.chart.h + ' stitches' : '')],
      picture: picture
    };
  }

  function buildFramed(body, rec, p) {
    var sc = SC(), q = live(p), d = dataOf(q);
    var st = { frame: 'hoop', card: true };
    var preview = el('div', 'xse-frame-preview');
    var img = el('canvas', 'xse-frame-canvas');
    img.setAttribute('role', 'img');
    preview.appendChild(img);
    var status = el('p', 'muted xse-status', 'Drawing…');
    status.setAttribute('aria-live', 'polite');
    body.appendChild(field('Finish', seg([{ id: 'hoop', label: 'In a hoop' }, { id: 'frame', label: 'Mat and frame' },
      { id: 'none', label: 'Just the stitching' }], st.frame, function (v) { st.frame = v; paint(); })));
    body.appendChild(field('Picture', seg([{ id: 'card', label: 'Card with the name' }, { id: 'plain', label: 'Picture only' }],
      'card', function (v) { st.card = v === 'card'; paint(); })));
    body.appendChild(preview);
    body.appendChild(status);
    var row = el('div', 'xse-row');
    var save = btn('btn primary', '📤 Share or save');
    save.setAttribute('data-k', 'share');
    save.disabled = true;
    row.appendChild(save);
    body.appendChild(row);
    body.appendChild(el('p', 'muted xse-small', 'Made on this device. Nothing leaves it unless you share it.'));
    var token = 0, blob = null;
    function render(size) {
      var picSize = st.card ? Math.round(size * 0.84) : size;
      return pictureOf(q, picSize, st.frame).then(function (pic) {
        if (!st.card) return pic;
        var c = document.createElement('canvas');
        sc.draw(c, shareInfo(q, d, pic), { size: size, theme: fn(sc, 'theme') ? sc.theme(null) : undefined });
        return c;
      });
    }
    function paint() {
      var my = ++token;
      blob = null;
      save.disabled = true;
      status.textContent = 'Drawing…';
      render(st.card ? 1080 : 2048).then(function (c) {
        if (my !== token) return;
        if (!c) { status.textContent = 'The picture could not be made on this device.'; return; }
        img.width = c.width; img.height = c.height;
        var g = img.getContext('2d');
        g.clearRect(0, 0, img.width, img.height);
        g.drawImage(c, 0, 0);
        img.setAttribute('aria-label', (st.card ? 'Picture card of ' : 'Picture of ') + (q.name || 'the piece') +
          (st.frame === 'hoop' ? ' in a hoop' : st.frame === 'frame' ? ' in a mat and frame' : ''));
        var toBlob = fn(sc, 'toBlob') ? sc.toBlob(c) : new Promise(function (res) { c.toBlob(res, 'image/png'); });
        return toBlob.then(function (b) {
          if (my !== token) return;
          blob = b;
          save.disabled = !b;
          status.textContent = b ? 'Ready: ' + c.width + ' × ' + c.height + ' pixels.' : 'The picture could not be made.';
          rec.ready = !!b;
        });
      }, function () { if (my === token) status.textContent = 'The picture could not be made on this device.'; });
    }
    on(save, 'click', function () {
      if (!blob) return;
      var info = shareInfo(q, d, null);
      var name = fn(sc, 'fileName') ? sc.fileName(info) : 'thready-or-not-' + slug(q.name) + '.png';
      if (!st.card) name = name.replace(/\.png$/, '-' + (st.frame === 'none' ? 'stitching' : st.frame) + '.png');
      sc.share(blob, { filename: name, title: info.name, text: info.name + ' · Cross-stitch' }).then(function (r) {
        if (r === 'downloaded') rec.say('Picture saved.');
        else if (r === 'failed') rec.say('The picture could not be saved.');
      });
    });
    rec.paint = paint;
    rec.state = st;
    paint();
  }

  /* ================================================================== *
   * 10. #19 — the printable chart that knows my progress
   * ================================================================== */

  function printOptions(d, st) {
    var S = St(), saved = S && fn(S, 'craftSettings') ? S.craftSettings(CRAFT) : {};
    var spp = clampInt(saved.printSpp, 10, 200, 60);
    var o = {
      color: st.color, key: st.key, progress: st.progress, remaining: st.remaining,
      parking: st.parking, overlap: st.overlap, stitchesPerPage: { w: spp, h: Math.round(spp * 4 / 3) }
    };
    if (st.original && hasRegions(d)) o.pageNumbers = 'original';
    return o;
  }
  function hasRegions(d) {
    return !!(d && Array.isArray(d.pages) && d.pages.some(function (pg) { return pg && pg.region; }));
  }
  function openPrintable(html, title, rec) {
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (w && w.document) {
      try { w.document.open(); w.document.write(html); w.document.close(); if (w.focus) w.focus(); return true; } catch (e2) { /* blob link */ }
    }
    var url;
    try { url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); } catch (e3) { rec.say('That chart could not be opened for printing.'); return false; }
    var box = rec.linkBox;
    clear(box);
    box.appendChild(el('p', 'muted', 'Your browser kept the new window closed, so here is the link. Open it, then use Print.'));
    var a = el('a', 'btn primary block', 'Open the printable chart');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    box.appendChild(a);
    var s = el('a', 'linkish', 'or save it as a file');
    s.href = url; s.download = slug(title) + '-progress.html';
    box.appendChild(s);
    rec.cleanup(function () { window.setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 60000); });
    try { a.focus(); } catch (e4) { /* ignore */ }
    return false;
  }

  function buildPrint(body, rec, p) {
    var x = X(), q = live(p), d = dataOf(q);
    var regions = hasRegions(d);
    var st = { progress: true, remaining: false, original: regions, parking: (d.parking || []).length > 0, overlap: regions ? 2 : 0, color: true, key: true };
    var tt = x.totals(d);
    body.appendChild(el('p', 'muted', 'A print view opens in a new tab: done stitches shaded, the chart in page tiles and the key. ' +
      'Print it, or save it as a PDF.'));
    var sum = el('p', 'xse-big-line', tt.text);
    body.appendChild(sum);
    var pp = regions && fn(x, 'pageProgress') ? x.pageProgress(d) : [];
    if (pp.length) {
      var left = pp.filter(function (r) { return !r.complete && r.total > 0; }).length;
      body.appendChild(el('p', 'muted', left + ' of ' + pp.length + ' printed ' + plural(pp.length, 'page') + ' still ' + (left === 1 ? 'has' : 'have') + ' stitches to do.'));
    }
    var opts = el('div', 'xse-opts');
    opts.appendChild(checkRow('Shade the stitches I have done', 'Hatched, so what is left stands out.', st.progress, function (v) { st.progress = v; }));
    opts.appendChild(checkRow('Only pages with stitches left', 'Skip the pages you have finished.', st.remaining, function (v) { st.remaining = v; }));
    if (regions) opts.appendChild(checkRow('Keep the printed page numbers', 'Page 9 on paper is page 9 here.', st.original, function (v) { st.original = v; }));
    if ((d.parking || []).length) opts.appendChild(checkRow('Show parked threads', null, st.parking, function (v) { st.parking = v; }));
    opts.appendChild(checkRow('Key on every page', 'Just the colours on that page.', st.key, function (v) { st.key = v; }));
    body.appendChild(opts);
    var ov = el('input', 'xse-num');
    ov.type = 'number'; ov.min = '0'; ov.max = '3'; ov.inputMode = 'numeric'; ov.value = String(st.overlap);
    on(ov, 'input', function () { st.overlap = clampInt(ov.value, 0, 3, 0); });
    body.appendChild(field('Overlap with the next page (stitches)', ov, 'Greyed repeats of the neighbouring stitches, 0 to 3.'));
    body.appendChild(field('Style', seg([{ id: 'color', label: 'Colour' }, { id: 'bw', label: 'Black and white' }], 'color',
      function (v) { st.color = v === 'color'; })));
    var go = btn('btn primary block', '🖨️ Open the print view');
    go.setAttribute('data-k', 'print');
    on(go, 'click', function () {
      var fresh = dataOf(live(q)), html = '';
      try { html = x.printableHTML(fresh, printOptions(fresh, st)); } catch (e) { html = ''; }
      if (!html) { rec.say('That chart could not be prepared for printing.'); return; }
      openPrintable(html, q.name, rec);
    });
    body.appendChild(go);
    rec.linkBox = el('div', 'xse-link-box');
    body.appendChild(rec.linkBox);
    rec.state = st;
  }

  /* ================================================================== *
   * 11. #18 — join quadrant files, and the storage line
   * ================================================================== */

  function storageLine(u) {
    if (!u) return '';
    var parts = [];
    var isN = function (v) { return typeof v === 'number' && isFinite(v); };
    if (isN(u.localBytes) && u.localBytes > 0) parts.push(bytesText(u.localBytes) + ' of projects and settings');
    if (isN(u.blobBytes) && u.blobBytes > 0) parts.push(bytesText(u.blobBytes) + ' of pages, charts and pictures' + (isN(u.blobCount) ? ' (' + fmtInt(u.blobCount) + ' ' + plural(u.blobCount, 'file') + ')' : ''));
    var s = parts.length ? 'On this device: ' + parts.join(', ') + '.' : '';
    if (isN(u.quota) && u.quota > 0 && isN(u.usage)) {
      var pct = u.usage / u.quota * 100;
      s += ' ' + (pct < 1 ? 'Under 1%' : approx(Math.round(pct) + '%')) + ' of the space the browser allows is used.';
    }
    if (u.persisted === false) s += ' The browser may clear it when space runs low, so keep a backup.';
    return s.trim();
  }

  function buildJoin(body, rec, p) {
    var x = X(), S = St(), q = live(p), d = dataOf(q);
    var st = rec.joinState || (rec.joinState = { picked: [], name: (q.name || 'Chart') + ' (joined)' });
    var cands = otherProjects(q).map(function (o) { return { p: o, d: dataOf(o) }; }).filter(function (c) { return hasChart(c.d); });
    body.appendChild(el('p', 'muted', 'Some big charts come as separate files, one per quarter. Pick the other parts and the app ' +
      'puts them together as a new project. The originals stay as they are.'));
    if (!cands.length) {
      body.appendChild(el('p', 'xse-note', 'Import the other parts first (each as its own project), then come back here.'));
    }
    var ul = el('ul', 'xse-join-list');
    var me = el('li', 'xse-join-row');
    me.appendChild(checkRow(q.name + ' (this one)', d.chart.w + ' × ' + d.chart.h + ' stitches', true, function () { /* fixed */ }));
    me.querySelector('input').disabled = true;
    ul.appendChild(me);
    cands.forEach(function (c) {
      var li = el('li', 'xse-join-row');
      var picked = st.picked.indexOf(c.p.id) >= 0;
      li.appendChild(checkRow(c.p.name || 'Untitled', c.d.chart.w + ' × ' + c.d.chart.h + ' stitches' +
        (c.d.source && c.d.source.fileName ? ' · ' + c.d.source.fileName : ''), picked, function (v) {
        var i = st.picked.indexOf(c.p.id);
        if (v && i < 0) st.picked.push(c.p.id);
        if (!v && i >= 0) st.picked.splice(i, 1);
        paint();
      }));
      li.querySelector('input').setAttribute('data-k', 'pick-' + c.p.id);
      ul.appendChild(li);
    });
    body.appendChild(ul);
    var layoutBox = el('div', 'xse-join-layout');
    body.appendChild(layoutBox);
    var nameIn = el('input');
    nameIn.type = 'text';
    nameIn.value = st.name;
    on(nameIn, 'input', function () { st.name = nameIn.value; });
    body.appendChild(field('Name of the joined project', nameIn));
    var go = btn('btn primary block', '🧩 Make the joined project');
    go.setAttribute('data-k', 'join');
    body.appendChild(go);
    var result = el('div', 'xse-join-result');
    body.appendChild(result);
    var storage = el('p', 'muted xse-storage');
    body.appendChild(storage);

    function parts() {
      var list = [{ p: q, d: d }];
      st.picked.forEach(function (id) {
        for (var i = 0; i < cands.length; i++) if (cands[i].p.id === id) list.push(cands[i]);
      });
      var names = list.map(function (c) { return (c.p.name || '') + ' ' + ((c.d.source && c.d.source.fileName) || ''); });
      var lay = x.quadrantLayout(list.map(function (c) { return c.d; }), names);
      return list.map(function (c, i) { return { p: c.p, d: c.d, x: lay[i].x, y: lay[i].y }; });
    }
    function paint() {
      clear(layoutBox);
      var ps = parts(), W = 0, H = 0;
      ps.forEach(function (c) { W = Math.max(W, c.x + c.d.chart.w); H = Math.max(H, c.y + c.d.chart.h); });
      go.disabled = ps.length < 2;
      if (ps.length < 2) { layoutBox.appendChild(el('p', 'muted', 'Pick at least one more part.')); return; }
      var map = el('div', 'xse-join-map');
      map.style.paddingBottom = Math.round(Math.min(1.6, H / W) * 100) + '%';
      map.setAttribute('role', 'img');
      map.setAttribute('aria-label', 'How the parts fit: ' + ps.map(function (c) {
        return c.p.name + ' at column ' + (c.x + 1) + ', row ' + (c.y + 1);
      }).join('; '));
      ps.forEach(function (c) {
        var b = el('span', 'xse-join-piece', c.p.name);
        b.style.left = (c.x / W * 100) + '%'; b.style.top = (c.y / H * 100) + '%';
        b.style.width = (c.d.chart.w / W * 100) + '%'; b.style.height = (c.d.chart.h / H * 100) + '%';
        map.appendChild(b);
      });
      layoutBox.appendChild(map);
      layoutBox.appendChild(el('p', 'xse-big-line', W + ' × ' + H + ' stitches'));
      if (W * H > 4000000) layoutBox.appendChild(el('p', 'xse-warn', 'That is over the 4 million squares the app can hold in one chart.'));
      layoutBox.appendChild(el('p', 'muted', 'Placed by the names (top left, TR, bottom right…) where they say; otherwise two to a row in the order picked.'));
      rec.layout = { W: W, H: H, parts: ps.length };
    }
    on(go, 'click', function () {
      var ps = parts();
      if (ps.length < 2) return;
      go.disabled = true;
      rec.say('Joining…');
      window.setTimeout(function () {
        var res = null;
        try {
          res = x.joinCharts(ps.map(function (c) { return { data: c.d, x: c.x, y: c.y }; }),
            { labels: ps.map(function (c) { return String(c.p.name || '').slice(0, 24); }) });
        } catch (e) { res = { data: null, error: 'failed' }; }
        go.disabled = false;
        clear(result);
        if (!res || !res.data) {
          rec.say(res && res.error === 'too big' ? 'That would be ' + res.w + ' × ' + res.h + ' stitches, more than the app can hold.' : 'Those files could not be joined.');
          return;
        }
        var np = null;
        try {
          np = S.createProject({ craft: CRAFT, name: st.name || ((q.name || 'Chart') + ' (joined)'), emoji: q.emoji, craftData: res.data });
        } catch (e2) { np = null; }
        if (!np) { rec.say('The joined chart could not be saved (the device may be out of space).'); return; }
        rec.joined = { id: np.id, w: res.w, h: res.h, conflicts: res.conflicts };
        result.appendChild(el('p', 'xse-big-line', 'Made “' + np.name + '”: ' + res.w + ' × ' + res.h + ' stitches.'));
        result.appendChild(el('p', 'muted', 'It is on your home screen. The original files are unchanged.' +
          (res.conflicts ? ' ' + fmtInt(res.conflicts) + ' ' + plural(res.conflicts, 'square') + ' overlapped with a different colour; the later file’s colour was kept.' : '')));
        notify(np.id, 'join');
        rec.say('Joined chart made.');
        usage();
      }, 30);
    });
    function usage() {
      if (!fn(S, 'storageUsage')) return;
      var pr = S.storageUsage();
      if (pr && pr.then) pr.then(function (u) { storage.textContent = storageLine(u); }, function () { /* ignore */ });
    }
    paint();
    usage();
  }

  /* ================================================================== *
   * 12. the menu and the public surface
   * ================================================================== */

  var ITEMS = [
    { id: 'pace', label: 'Stitching time and goals', icon: '⏱️', hint: 'Sessions, pace, a finish estimate and goals', build: buildPace, title: 'Stitching time and goals',
      ok: function (p, d) { var x = X(); return fns(x, ['totals', 'goalProgress']) && fns(St(), ['activity', 'pace']) && !!d; } },
    { id: 'fabric', label: 'Fabric, hoop and frame', icon: '📐', hint: 'How much fabric to cut, and the hoop or frame it needs', build: buildFabric, title: 'Fabric, hoop and frame',
      ok: function (p, d) { return fns(X(), ['fabricPlan', 'frameFit']) && !!designSize(d) && fn(St(), 'updateCraftData'); } },
    { id: 'kit', label: 'Floss stash and kit list', icon: '🧵', hint: 'What to buy after what you own', build: buildKit, title: 'Floss stash and kit list',
      ok: function (p, d) { return fns(X(), ['kitList', 'flossId']) && fns(St(), ['profile', 'adjustFloss', 'flossOwned']) && !!(d && d.palette && d.palette.length); } },
    { id: 'brands', label: 'Other brands and substitutes', icon: '🎨', hint: 'Nearest colours in other brands and your stash', build: buildBrands, title: 'Other brands and substitutes',
      ok: function (p, d) { return fns(X(), ['convert', 'brandTables', 'substitutes']) && !!(d && d.palette && d.palette.length); } },
    { id: 'grow', label: 'Watch it grow', icon: '🎞️', hint: 'A replay of the piece filling in', build: buildGrow, title: 'Watch it grow',
      ok: function (p, d) { return fns(R(), ['mount', 'timelapse']) && hasChart(d) && doneCount(d) > 0; } },
    { id: 'framed', label: 'Framed picture', icon: '🖼️', hint: 'The piece in a hoop or frame, to share', build: buildFramed, title: 'Framed picture',
      ok: function (p, d) { return fn(R(), 'picture') && fns(SC(), ['draw', 'share']) && hasChart(d) && fn(X(), 'totals'); } },
    { id: 'print', label: 'Print what’s left', icon: '🖨️', hint: 'A printable chart with your done stitches shaded', build: buildPrint, title: 'Print what’s left',
      ok: function (p, d) { return fns(X(), ['printableHTML', 'totals']) && hasChart(d); } },
    { id: 'join', label: 'Join with other files', icon: '🧩', hint: 'Put quarter files of one design together', build: buildJoin, title: 'Join with other files',
      ok: function (p, d) { return fns(X(), ['joinCharts', 'quadrantLayout']) && hasChart(d) && fns(St(), ['createProject', 'projects']); } }
  ];
  function item(id) { for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i]; return null; }

  function menuItems(project) {
    var p = live(project);
    if (!p || !isXs(p) || !X() || !St()) return [];
    var d;
    try { d = dataOf(p); } catch (e) { return []; }
    var out = [];
    ITEMS.forEach(function (it) {
      var ok = false;
      try { ok = !!it.ok(p, d); } catch (e) { ok = false; }
      if (ok) out.push({ id: it.id, label: it.label, icon: it.icon, hint: it.hint });
    });
    return out;
  }

  function open(id, project, opts) {
    opts = isObj(opts) ? opts : {};
    var it = item(id), p = live(project);
    if (!it || !p || !isXs(p)) return false;
    var d;
    try { d = dataOf(p); if (!it.ok(p, d)) return false; } catch (e) { return false; }
    if (opts.ctx) env.ctx = opts.ctx;
    else if (!env.ctx && window.App && window.App.ctx && document.getElementById('app')) env.ctx = window.App.ctx;
    if (opts.app) env.app = opts.app;
    var title = it.title;
    openSheet(id, p, title, function (body, rec) {
      try { it.build(body, rec, p, opts); } catch (e) {
        clear(body);
        body.appendChild(el('p', 'xse-warn', 'This sheet could not open: ' + (e && e.message ? e.message : 'unknown error') + '.'));
        if (window.console) console.error(e);
      }
    });
    return true;
  }

  window.XStitchExtras = {
    version: 1,
    menuItems: menuItems,
    open: open,
    close: closeCurrent,
    __test: {
      fmtDate: fmtDate, approx: approx, parseLength: parseLength, toUnit: toUnit, goalStore: goalStore,
      orderFromChunks: orderFromChunks, shoppingText: shoppingText, storageLine: storageLine, printOptions: printOptions,
      kitFor: kitFor, craftKeepsGoals: craftKeepsGoals, unitFor: unitFor, dateAt: dateAt,
      lastSheet: function () { return current ? { id: current.id, root: current.root, rec: current } : null; },
      useEnv: function (ctx, a) { env.ctx = ctx || null; env.app = a || null; }
    }
  };
})();
