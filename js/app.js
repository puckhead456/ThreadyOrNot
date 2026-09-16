/* Stitchkeeper — js/app.js
 * window.App : rendering + event handling (the whole UI).
 * All state changes go through window.Store. Optional collaborators
 * (window.Themes / window.Patterns / window.Celebrate) are used defensively.
 */
(function () {
  'use strict';

  var APP_VERSION = '1.0.0';

  var EMOJI = [
    '🧶', '🐑', '🐄', '🐖', '🐔', '🐰', '🐉', '🐲', '🦖', '🐢',
    '🐙', '🐸', '🦊', '🐻', '🧣', '🧥', '🧸', '🌵', '🌙', '⭐',
    // craft-module templates (cross-stitch, sewing)
    '🧵', '🪡', '🌸', '🎁', '👜', '🛏️'
  ];

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var STATUS_INFO = [
    { id: 'active', label: 'Active', desc: 'You are working on this right now.' },
    { id: 'paused', label: 'Paused', desc: 'Hibernating. Still on the home screen, just resting.' },
    { id: 'finished', label: 'Finished', desc: 'Done and dusted. Moves to the finished shelf.' },
    { id: 'frogged', label: 'Frogged', desc: 'Ripped back for good. Kept for the record.' }
  ];

  /* ================================================================== *
   * 1. Tiny DOM helpers
   * ================================================================== */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function button(cls, text, label) {
    var b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function on(node, type, fn) {
    if (node) node.addEventListener(type, fn);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        fn.apply(self, args);
      }, ms);
    };
  }

  function noop() {}

  /* ================================================================== *
   * 2. Formatting helpers
   * ================================================================== */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** h:mm:ss */
  function fmtDuration(ms) {
    var s = Math.max(0, Math.floor((ms || 0) / 1000));
    var h = Math.floor(s / 3600);
    s -= h * 3600;
    var m = Math.floor(s / 60);
    s -= m * 60;
    return h + ':' + pad2(m) + ':' + pad2(s);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** "3m ago" / "2h ago" / "yesterday" / "Sep 3" */
  function ago(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 45 * 1000) return 'just now';
    if (diff < 60 * 60 * 1000) return Math.max(1, Math.floor(diff / 60000)) + 'm ago';
    if (diff < 24 * 60 * 60 * 1000) return Math.max(1, Math.floor(diff / 3600000)) + 'h ago';
    var then = new Date(ts);
    var days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86400000);
    if (days === 1) return 'yesterday';
    return MONTHS[then.getMonth()] + ' ' + then.getDate();
  }

  function fmtClock(ts) {
    var d = new Date(ts);
    var time;
    try {
      time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    var sameDay = startOfDay(d) === startOfDay(new Date());
    return sameDay ? time : MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + time;
  }

  function rowWord(project, caps) {
    var w = project && project.countMode === 'rounds' ? 'Round' : 'Row';
    return caps ? w.toUpperCase() : w;
  }

  function shortRowWord(project) {
    return project && project.countMode === 'rounds' ? 'Rnd' : 'Row';
  }

  /* ================================================================== *
   * 3. Optional collaborators (defensive)
   * ================================================================== */

  function fb(method) {
    try {
      if (window.Feedback && typeof window.Feedback[method] === 'function') window.Feedback[method]();
    } catch (e) {
      /* ignore */
    }
  }

  function celebrate(kind) {
    try {
      if (window.Celebrate && typeof window.Celebrate.play === 'function') {
        var r = window.Celebrate.play(Store.settings().theme, { kind: kind });
        if (r && typeof r.catch === 'function') r.catch(noop);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function themeList() {
    return Array.isArray(window.Themes) ? window.Themes : [];
  }

  /* ================================================================== *
   * 4. Element references
   * ================================================================== */

  var els = {};

  function cacheEls() {
    els.home = $('#screen-home');
    els.project = $('#screen-project');
    els.live = $('#live-region');
    els.toasts = $('#toasts');

    // Craft screen (docs/CRAFTS.md) — absent from an old cached index.html,
    // so everything that touches it is guarded.
    els.craft = $('#screen-craft');
    els.craftBody = $('#craft-body');
    els.cEmoji = $('#c-emoji');
    els.cName = $('#c-name');
    els.cTimer = $('#c-timer');

    els.homeEmpty = $('#home-empty');
    els.welcome = $('#welcome-card');
    els.homeList = $('#home-list');
    els.finishedWrap = $('#home-finished');
    els.finishedToggle = $('#finished-toggle');
    els.finishedLabel = $('#finished-label');
    els.finishedList = $('#finished-list');

    els.pEmoji = $('#p-emoji');
    els.pName = $('#p-name');
    els.pTimer = $('#p-timer');
    els.tabs = $('#part-tabs');
    els.repeat = $('#repeat-readout');
    els.rowLabel = $('#row-label');
    els.rowNumber = $('#row-number');
    els.rowProgress = $('#row-progress');
    els.rowBarFill = $('#row-bar-fill');
    els.rowBarLabel = $('#row-bar-label');
    els.setupLine = $('#setup-line');
    els.setupText = $('#setup-line-text');
    els.patternLine = $('#pattern-line');
    els.patternTag = $('#pattern-line-tag');
    els.patternText = $('#pattern-line-text');
    els.patternNotes = $('#pattern-line-notes');
    els.stitchSection = $('.stitch-section');
    els.stitchBtn = $('#stitch-btn');
    els.stitchNumber = $('#stitch-number');
    els.stitchReadout = $('#stitch-readout');
    els.stitchProgress = $('#stitch-progress');
    els.stitchBarFill = $('#stitch-bar-fill');
    els.stitchBarLabel = $('#stitch-bar-label');
    els.btnUndo = $('#btn-undo');
    els.btnWake = $('#btn-wake');
    els.btnAlerts = $('#btn-alerts');
    els.alertsText = $('#alerts-text');
    els.btnPlace = $('#btn-place');
  }

  /* ================================================================== *
   * 5. Live region + toasts
   * ================================================================== */

  function announce(text) {
    if (!els.live) return;
    els.live.textContent = '';
    // A fresh text node in the next frame makes screen readers re-announce.
    window.setTimeout(function () {
      els.live.textContent = text;
    }, 30);
  }

  /**
   * @param {string} msg
   * @param {{ actionText?: string, onAction?: Function, ms?: number }} [opts]
   */
  function toast(msg, opts) {
    opts = opts || {};
    if (!els.toasts) return;
    var node = el('div', 'toast');
    node.appendChild(el('span', 'toast-text', msg));
    var timer = null;
    function dismiss() {
      if (timer) clearTimeout(timer);
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    if (opts.actionText && opts.onAction) {
      var act = button('toast-action', opts.actionText);
      on(act, 'click', function () {
        dismiss();
        opts.onAction();
      });
      node.appendChild(act);
    }
    els.toasts.appendChild(node);
    timer = setTimeout(dismiss, opts.ms || 2600);
    return dismiss;
  }

  /* ================================================================== *
   * 6. Sheets (dynamic <dialog>)
   * ================================================================== */

  var openSheets = [];

  /**
   * @param {{title:string, cls?:string, build?:Function, footer?:Array, onClose?:Function}} opts
   */
  function openSheet(opts) {
    opts = opts || {};
    var dlg = document.createElement('dialog');
    dlg.className = 'sheet' + (opts.cls ? ' ' + opts.cls : '');

    var inner = el('div', 'sheet-inner');
    var head = el('div', 'sheet-head');
    head.appendChild(el('div', 'sheet-grab'));
    var h = el('h2', 'sheet-title', opts.title || '');
    var closeBtn = button('sheet-close', '✕', 'Close');
    head.appendChild(h);
    head.appendChild(closeBtn);

    var body = el('div', 'sheet-body');
    inner.appendChild(head);
    inner.appendChild(body);

    var result;
    var torndown = false;

    /**
     * Unhook the sheet. Runs from the dialog's `close` event, and also
     * straight after `dlg.close()` — a backgrounded tab can sit on that event
     * for a long time, and a sheet left in the DOM breaks later queries.
     */
    function teardown() {
      if (torndown) return;
      torndown = true;
      var i = openSheets.indexOf(api);
      if (i >= 0) openSheets.splice(i, 1);
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      if (opts.onClose) opts.onClose(result);
    }

    var api = {
      dialog: dlg,
      body: body,
      title: h,
      close: function (value) {
        result = value;
        try {
          dlg.close();
        } catch (e) {
          /* not open (or no <dialog> support) — teardown still handles it */
        }
        teardown();
      }
    };

    if (opts.footer && opts.footer.length) {
      var foot = el('div', 'sheet-foot');
      opts.footer.forEach(function (f) {
        var b = button(f.cls || 'btn', f.text);
        // A stable hook the guided tours can spotlight.
        if (f.tour) b.setAttribute('data-tour', f.tour);
        on(b, 'click', function () {
          f.onClick(api);
        });
        foot.appendChild(b);
      });
      inner.appendChild(foot);
    }

    dlg.appendChild(inner);
    document.body.appendChild(dlg);

    on(closeBtn, 'click', function () {
      api.close();
    });
    on(dlg, 'click', function (e) {
      if (e.target === dlg) api.close();
    });
    on(dlg, 'close', teardown);
    // Escape: <dialog> fires cancel then close — nothing extra needed.

    if (opts.build) opts.build(body, api);

    openSheets.push(api);
    if (typeof dlg.showModal === 'function') {
      dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
    return api;
  }

  function closeAllSheets() {
    openSheets.slice().forEach(function (s) {
      s.close();
    });
  }

  /** Custom confirm sheet (window.confirm looks wrong in standalone PWAs). */
  function confirmSheet(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var settled = false;
      openSheet({
        title: opts.title || 'Are you sure?',
        cls: 'sheet-confirm',
        build: function (body) {
          if (opts.message) body.appendChild(el('p', 'muted', opts.message));
        },
        footer: [
          {
            text: opts.cancelText || 'Cancel',
            cls: 'btn ghost',
            onClick: function (api) {
              api.close(false);
            }
          },
          {
            text: opts.confirmText || 'OK',
            cls: 'btn ' + (opts.danger ? 'danger' : 'primary'),
            onClick: function (api) {
              api.close(true);
            }
          }
        ],
        onClose: function (v) {
          if (settled) return;
          settled = true;
          resolve(v === true);
        }
      });
    });
  }

  /* ================================================================== *
   * 7. Form control builders
   * ================================================================== */

  var autoIdSeq = 0;

  function field(labelText, control, hint) {
    var wrap = el('div', 'field');
    if (labelText) {
      var lab = el('label', null, labelText);
      if (control && /^(INPUT|TEXTAREA|SELECT)$/.test(control.tagName || '')) {
        if (!control.id) control.id = 'sk-f' + ++autoIdSeq;
        lab.setAttribute('for', control.id);
      }
      wrap.appendChild(lab);
    }
    if (control) wrap.appendChild(control);
    if (hint) wrap.appendChild(el('div', 'field-hint', hint));
    return wrap;
  }

  function textInput(value, placeholder) {
    var i = document.createElement('input');
    i.type = 'text';
    i.value = value == null ? '' : String(value);
    if (placeholder) i.placeholder = placeholder;
    return i;
  }

  function numInput(value, min, max, placeholder) {
    var i = document.createElement('input');
    i.type = 'number';
    i.inputMode = 'numeric';
    if (min != null) i.min = String(min);
    if (max != null) i.max = String(max);
    i.value = value == null ? '' : String(value);
    if (placeholder) i.placeholder = placeholder;
    return i;
  }

  function textArea(value, cls, placeholder) {
    var t = document.createElement('textarea');
    t.className = cls || '';
    t.value = value == null ? '' : String(value);
    if (placeholder) t.placeholder = placeholder;
    return t;
  }

  function stepper(value, min, max, label) {
    var wrap = el('div', 'stepper');
    var dec = button(null, '−', 'Decrease ' + (label || 'value'));
    var input = numInput(value, min, max);
    var inc = button(null, '+', 'Increase ' + (label || 'value'));
    function get() {
      var n = parseInt(input.value, 10);
      if (!isFinite(n)) n = min;
      return Math.min(max, Math.max(min, n));
    }
    function set(n) {
      input.value = String(Math.min(max, Math.max(min, n)));
    }
    on(dec, 'click', function () { set(get() - 1); });
    on(inc, 'click', function () { set(get() + 1); });
    wrap.appendChild(dec);
    wrap.appendChild(input);
    wrap.appendChild(inc);
    return { node: wrap, input: input, get: get, set: set };
  }

  function segmented(options, current, onPick) {
    var wrap = el('div', 'seg');
    var value = current;
    var buttons = {};
    options.forEach(function (o) {
      var b = button(value === o.id ? 'on' : null, o.label);
      buttons[o.id] = b;
      on(b, 'click', function () {
        value = o.id;
        Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        if (onPick) onPick(value);
      });
      wrap.appendChild(b);
    });
    return {
      node: wrap,
      get: function () { return value; },
      set: function (id) {
        if (!buttons[id]) return;
        value = id;
        Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('on'); });
        buttons[id].classList.add('on');
      }
    };
  }

  function switchRow(labelText, subText, checked, onToggle) {
    var row = el('div', 'toggle-row');
    var left = el('div');
    left.appendChild(el('div', 'toggle-label', labelText));
    if (subText) left.appendChild(el('div', 'toggle-sub', subText));
    var sw = button('switch');
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', checked ? 'true' : 'false');
    sw.setAttribute('aria-label', labelText);
    on(sw, 'click', function () {
      var next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', next ? 'true' : 'false');
      onToggle(next);
    });
    row.appendChild(left);
    row.appendChild(sw);
    return row;
  }

  function emojiGrid(current, onPick) {
    var grid = el('div', 'emoji-grid');
    var value = current;
    var buttons = {};
    EMOJI.forEach(function (e) {
      var b = button('emoji-btn' + (e === value ? ' on' : ''), e, 'Emoji ' + e);
      buttons[e] = b;
      on(b, 'click', function () {
        value = e;
        Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        if (onPick) onPick(value);
      });
      grid.appendChild(b);
    });
    return {
      node: grid,
      get: function () { return value; },
      set: function (e) {
        if (!e) return;
        value = e;
        Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove('on'); });
        if (buttons[e]) buttons[e].classList.add('on');
      }
    };
  }

  function parseNumberList(text) {
    var out = [];
    String(text || '').split(/[,\s]+/).forEach(function (chunk) {
      var n = parseInt(chunk, 10);
      if (isFinite(n) && n > 0 && out.indexOf(n) === -1) out.push(n);
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /* ================================================================== *
   * 8. Theme
   * ================================================================== */

  function applyTheme(id, persist) {
    if (!id) return;
    document.documentElement.setAttribute('data-theme', id);
    if (persist !== false) Store.setSetting('theme', id);
    window.requestAnimationFrame(function () {
      updateThemeColor();
      // The diagram paints with the theme's own colours.
      setDiagramPalette();
      // So do craft canvases, which cache their palette the same way.
      if (activeCraft && activeCraft.def && typeof activeCraft.def.onTheme === 'function') {
        try { activeCraft.def.onTheme(); } catch (e) { /* ignore */ }
      }
    });
  }

  function updateThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    var cs = window.getComputedStyle(document.documentElement);
    var header = (cs.getPropertyValue('--header-bg') || '').trim();
    var color = header;
    if (!color || /gradient|url\(|image/i.test(color)) {
      color = (cs.getPropertyValue('--bg') || '').trim();
    }
    if (color) meta.setAttribute('content', color);
  }

  /* ================================================================== *
   * 9. Wake lock
   * ================================================================== */

  var wakeLock = null;
  var wakeSupported = !!(navigator.wakeLock && typeof navigator.wakeLock.request === 'function');

  function wantsWakeLock() {
    return (
      wakeSupported &&
      Store.settings().keepAwake &&
      currentProject() !== null &&
      document.visibilityState === 'visible'
    );
  }

  function syncWakeLock() {
    if (!wakeSupported) return;
    if (wantsWakeLock()) {
      if (wakeLock) return;
      try {
        navigator.wakeLock
          .request('screen')
          .then(function (lock) {
            wakeLock = lock;
            lock.addEventListener('release', function () {
              wakeLock = null;
            });
          })
          .catch(function () {
            wakeLock = null;
          });
      } catch (e) {
        wakeLock = null;
      }
    } else if (wakeLock) {
      try {
        wakeLock.release();
      } catch (e) {
        /* ignore */
      }
      wakeLock = null;
    }
  }

  /* ================================================================== *
   * 9b. Crafts (docs/CRAFTS.md)
   *
   * Crochet is the shell itself and is never registered; it is listed here so
   * the craft picker, the home-card badge and the Settings line can treat all
   * crafts alike. Every entry point checks the module exists before calling
   * into it, so a craft file that failed to load degrades to a friendly card.
   * ================================================================== */

  var CROCHET = {
    id: 'crochet',
    name: 'Crochet',
    emoji: '🧶',
    tagline: 'Rows, rounds and stitches, with the live 3D piece.'
  };

  var craftDefs = Object.create(null);
  var craftOrder = [];

  /** The project screen currently painted by a craft module, if any. */
  var activeCraft = null;

  function registerCraft(def) {
    if (!def || typeof def !== 'object') return null;
    var id = typeof def.id === 'string' ? def.id.trim() : '';
    if (!id || id === CROCHET.id) return null;
    if (!craftDefs[id]) craftOrder.push(id);
    craftDefs[id] = def;
    // Registering after boot (a late module, a console experiment) still shows
    // up straight away.
    if (booted) {
      if (typeof def.onInit === 'function') {
        try { def.onInit(ctx); } catch (e) { /* a broken module is not fatal */ }
      }
      render();
    }
    return def;
  }

  /** `[{ id, name, emoji, tagline }]` — crochet first, then registration order. */
  function craftList() {
    var out = [CROCHET];
    craftOrder.forEach(function (id) {
      var d = craftDefs[id];
      if (!d) return;
      out.push({
        id: id,
        name: d.name || id,
        emoji: d.emoji || '🧵',
        tagline: d.tagline || ''
      });
    });
    return out;
  }

  /** Display info for any craft id, including one whose module never loaded. */
  function craftInfo(id) {
    var key = id || CROCHET.id;
    if (key === CROCHET.id) return CROCHET;
    var d = craftDefs[key];
    if (d) return { id: key, name: d.name || key, emoji: d.emoji || '🧵', tagline: d.tagline || '' };
    return { id: key, name: key, emoji: '🧵', tagline: '' };
  }

  /** True once more than one craft can be picked. */
  function multiCraft() {
    return craftOrder.length > 0;
  }

  function isCraftProject(p) {
    return !!(p && p.craft && p.craft !== CROCHET.id);
  }

  /** The registered module for a project, or null (crochet, or not loaded). */
  function craftFor(p) {
    if (!isCraftProject(p)) return null;
    return craftDefs[p.craft] || null;
  }

  /* ================================================================== *
   * 9c. The craft context — the shell's own helpers, handed to modules
   * ================================================================== */

  var ctx = {
    // DOM + controls
    el: el,
    button: button,
    on: on,
    clear: clear,
    field: field,
    textInput: textInput,
    numInput: numInput,
    textArea: textArea,
    stepper: stepper,
    segmented: segmented,
    switchRow: switchRow,

    // Chrome
    openSheet: openSheet,
    confirmSheet: confirmSheet,
    closeAllSheets: closeAllSheets,
    toast: toast,
    announce: announce,
    fb: fb,
    render: render,

    // Project plumbing
    currentProject: currentProject,
    openProjectEditor: openProjectEditor,
    openChecklistSheet: openChecklistSheet,
    openNotesSheet: openNotesSheet,
    openHistorySheet: openHistorySheet,
    openStatusSheet: openStatusSheet,
    celebrate: celebrate,

    // Presentation
    prefersReducedMotion: prefersReducedMotion,
    cssVar: cssVar,

    // Files
    isPdfFile: isPdfFile,
    firstFile: firstFile,
    pdfDropZone: pdfDropZone,
    /** The name docs/CRAFTS.md uses in its ctx table for the same builder. */
    readPdfInto: pdfDropZone,

    // Screen wake lock, so craft bottom bars can offer the same Awake toggle
    // as the crochet screen (the lock itself follows any open project).
    wake: {
      supported: wakeSupported,
      isOn: function () { return !!Store.settings().keepAwake; },
      toggle: function () {
        var next = !Store.settings().keepAwake;
        Store.setSetting('keepAwake', next);
        syncWakeLock();
        toast(next ? 'Screen will stay awake' : 'Screen can sleep again');
        return next;
      }
    },

    // Help
    addFaq: addFaq
  };

  function addFaq(entry) {
    if (!entry || typeof entry !== 'object') return false;
    var q = typeof entry.q === 'string' ? entry.q.trim() : '';
    var a = typeof entry.a === 'string' ? entry.a.trim() : '';
    if (!q || !a) return false;
    for (var i = 0; i < FAQ.length; i++) if (FAQ[i].q === q) return false;
    FAQ.push({ q: q, a: a });
    return true;
  }

  /* ================================================================== *
   * 10. Current selection helpers
   * ================================================================== */

  function currentProject() {
    return Store.project(Store.getState().activeProjectId);
  }

  function currentPart() {
    var p = currentProject();
    return p ? Store.activePart(p) : null;
  }

  function openProject(id) {
    Store.setActiveProject(id);
    render();
  }

  function goHome() {
    Store.setActiveProject(null);
    render();
  }

  /* ================================================================== *
   * 11. Render — router
   * ================================================================== */

  function render() {
    var p = currentProject();
    if (p && isCraftProject(p)) {
      // A craft module owns this screen.
      els.home.hidden = true;
      els.project.hidden = true;
      if (els.craft) els.craft.hidden = false;
      destroyLiveDiagram();
      renderCraftProject(p);
    } else if (p) {
      destroyCraftProject();
      if (els.craft) els.craft.hidden = true;
      els.home.hidden = true;
      els.project.hidden = false;
      renderProject(p);
    } else {
      destroyCraftProject();
      if (els.craft) els.craft.hidden = true;
      els.project.hidden = true;
      els.home.hidden = false;
      // Leaving the project screen: the diagram goes with it.
      destroyLiveDiagram();
      renderHome();
    }
    syncWakeLock();
  }

  /* ================================================================== *
   * 12. Render — home
   * ================================================================== */

  function projectSummary(p) {
    // Crafts write their own line; Store.summaryFor falls back to this one.
    var craftLine = craftFor(p) && typeof Store.summaryFor === 'function' ? Store.summaryFor(p) : '';
    if (typeof craftLine === 'string' && craftLine) return craftLine;

    var prt = Store.activePart(p);
    if (!prt) return '';
    var bits = [prt.name, shortRowWord(p) + ' ' + prt.row];
    var target = Store.currentTarget(prt);
    bits.push(target ? prt.stitch + '/' + target + ' sts' : prt.stitch + ' sts');
    return bits.join(' · ');
  }

  function projectCard(p) {
    var card = button('project-card');
    card.setAttribute('aria-label', 'Open ' + p.name);

    card.appendChild(el('span', 'pc-emoji', p.emoji));
    // More than one craft in the app: say which one this card is.
    if (multiCraft()) {
      var info = craftInfo(p.craft);
      var badge = el('span', 'pc-craft', info.emoji);
      badge.setAttribute('title', info.name);
      badge.setAttribute('aria-label', info.name);
      card.appendChild(badge);
    }
    card.appendChild(el('span', 'pc-name', p.name));

    var pill = el('span', 'pill ' + p.status + ' pc-pill', p.status);
    card.appendChild(pill);

    card.appendChild(el('span', 'pc-summary', projectSummary(p)));

    var meta = el('span', 'pc-meta');
    meta.appendChild(document.createTextNode(ago(p.updatedAt)));
    meta.appendChild(document.createTextNode(' · '));
    var t = el('span', 'pc-time', fmtDuration(Store.elapsedMs(p)));
    t.setAttribute('data-timer-project', p.id);
    meta.appendChild(t);
    card.appendChild(meta);

    on(card, 'click', function () {
      openProject(p.id);
    });
    return card;
  }

  var finishedOpen = false;

  function renderHome() {
    var all = Store.projects();
    var live = [];
    var done = [];
    all.forEach(function (p) {
      if (p.status === 'finished' || p.status === 'frogged') done.push(p);
      else live.push(p);
    });
    live.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    done.sort(function (a, b) { return (b.finishedAt || b.updatedAt) - (a.finishedAt || a.updatedAt); });

    els.homeEmpty.hidden = all.length > 0;
    // First ever visit: offer the guided tour from the empty state.
    if (els.welcome) {
      els.welcome.hidden = !(all.length === 0 && !Store.settings().welcomed && tourAvailable());
    }

    clear(els.homeList);
    live.forEach(function (p) {
      els.homeList.appendChild(projectCard(p));
    });

    els.finishedWrap.hidden = done.length === 0;
    els.finishedLabel.textContent = 'Finished shelf (' + done.length + ')';
    els.finishedToggle.setAttribute('aria-expanded', finishedOpen ? 'true' : 'false');
    els.finishedList.hidden = !finishedOpen;
    clear(els.finishedList);
    done.forEach(function (p) {
      els.finishedList.appendChild(projectCard(p));
    });
  }

  /* ================================================================== *
   * 13. Render — project
   * ================================================================== */

  function renderTabs(p) {
    clear(els.tabs);
    p.parts.forEach(function (prt) {
      var isActive = prt.id === p.activePartId;
      var tab = button('tab' + (isActive ? ' active' : ''));
      tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      tab.setAttribute(
        'aria-label',
        prt.name + (isActive ? ' (current part — tap to edit)' : '')
      );
      tab.appendChild(document.createTextNode(prt.name));
      if (prt.makeCount > 1) {
        tab.appendChild(document.createTextNode(' '));
        tab.appendChild(el('span', 'tab-badge', prt.piecesDone + '/' + prt.makeCount));
      }
      if (prt.piecesDone >= prt.makeCount && prt.targetRows) {
        tab.appendChild(document.createTextNode(' ✓'));
      }
      on(tab, 'click', function () {
        if (isActive) {
          openPartEditor(p.id, prt.id);
        } else {
          Store.setActivePart(p.id, prt.id);
          render();
        }
      });
      els.tabs.appendChild(tab);
    });

    var add = button('tab tab-add', '＋ part', 'Add a part');
    on(add, 'click', function () {
      addPartFlow(p.id);
    });
    els.tabs.appendChild(add);
  }

  function updateTimerChip(p) {
    if (!els.pTimer) return;
    els.pTimer.textContent = fmtDuration(Store.elapsedMs(p));
    var running = !!(p.timer && p.timer.runningSince);
    els.pTimer.classList.toggle('running', running);
    els.pTimer.setAttribute('aria-label', (running ? 'Stop' : 'Start') + ' timer, ' + fmtDuration(Store.elapsedMs(p)));
  }

  /** Fast path: only the numbers and readouts. */
  function updateCounters(p, prt) {
    if (!p || !prt) return;

    els.rowLabel.textContent = rowWord(p, true);
    els.rowNumber.textContent = String(prt.row);

    if (prt.targetRows) {
      els.rowProgress.hidden = false;
      var pct = Math.max(0, Math.min(100, (prt.row / prt.targetRows) * 100));
      els.rowBarFill.style.width = pct + '%';
      var lbl = prt.row + ' / ' + prt.targetRows;
      if (prt.makeCount > 1) {
        lbl += ' · piece ' + Math.min(prt.piecesDone + 1, prt.makeCount) + ' of ' + prt.makeCount;
      }
      els.rowBarLabel.textContent = lbl;
    } else {
      els.rowProgress.hidden = true;
    }

    // Repeat readout
    var ri = Store.repeatInfo(prt);
    if (prt.repeat && prt.repeat.enabled) {
      els.repeat.hidden = false;
      if (ri.inside) {
        els.repeat.textContent =
          'Repeat ' + ri.k + ' of ' + ri.times + ' · ' + rowWord(p).toLowerCase() + ' ' + ri.j + ' of ' + ri.len;
      } else {
        els.repeat.textContent =
          'Repeat ' + rowWord(p).toLowerCase() + 's ' + prt.repeat.startRow + '–' + prt.repeat.endRow +
          ' × ' + prt.repeat.times + ' (not in repeat)';
      }
    } else {
      els.repeat.hidden = true;
    }

    // Setup / foundation line — only while the first row is being worked.
    var setup = ri.workingRow === 1 ? Store.setupLine(prt) : null;
    if (setup && setup.text && els.setupLine) {
      els.setupLine.hidden = false;
      els.setupText.textContent = setup.text;
    } else if (els.setupLine) {
      els.setupLine.hidden = true;
    }

    // Pattern line
    var line = Store.lineForRow(prt, ri.patternRow);
    if (line && line.text) {
      els.patternLine.hidden = false;
      els.patternTag.textContent = shortRowWord(p) + ' ' + ri.patternRow;
      els.patternText.textContent = line.text;
      var notes = Store.notesOf(line);
      if (els.patternNotes) {
        els.patternNotes.hidden = !notes.length;
        els.patternNotes.textContent = notes.join(' · ');
      }
    } else {
      els.patternLine.hidden = true;
    }

    // Stitches
    els.stitchNumber.textContent = String(prt.stitch);
    var g = p.groupSize > 0 ? p.groupSize : 0;
    // `line` is the row the counter is on, so reuse it instead of a second lookup.
    var target = Store.currentTarget(prt);
    var approx = target && Store.isComputed(line) ? '≈ ' : '';
    var readout;
    if (g > 0) {
      var groupNo = prt.stitch === 0 ? 1 : Math.ceil(prt.stitch / g);
      var within = prt.stitch === 0 ? 0 : ((prt.stitch - 1) % g) + 1;
      readout = 'Group ' + groupNo;
      if (target) readout += ' of ' + approx + Math.ceil(target / g);
      readout += ' · stitch ' + within + ' of ' + g;
    } else {
      // Grouping off: just the plain stitch number.
      readout = 'stitch ' + prt.stitch;
    }
    els.stitchReadout.textContent = readout;

    if (target) {
      els.stitchProgress.hidden = false;
      var spct = Math.max(0, Math.min(100, (prt.stitch / target) * 100));
      els.stitchBarFill.style.width = spct + '%';
      els.stitchBarLabel.textContent = prt.stitch + ' / ' + approx + target;
    } else {
      els.stitchProgress.hidden = true;
    }
  }

  function updateBottomBar(p, prt) {
    els.btnUndo.disabled = !Store.canUndo();

    els.btnWake.hidden = !wakeSupported;
    var awake = !!Store.settings().keepAwake;
    els.btnWake.classList.toggle('on', awake);
    els.btnWake.setAttribute('aria-pressed', awake ? 'true' : 'false');

    var n = prt && prt.alerts ? prt.alerts.length : 0;
    els.alertsText.textContent = n ? 'Alerts ' + n : 'Alerts';
    els.btnAlerts.classList.toggle('on', n > 0);

    var hasPlace = !!(prt && prt.placementNotes && prt.placementNotes.trim());
    els.btnPlace.classList.toggle('on', hasPlace);
  }

  function renderProject(p) {
    var prt = Store.activePart(p);
    els.pEmoji.textContent = p.emoji;
    els.pName.textContent = p.name;
    updateTimerChip(p);
    renderTabs(p);
    updateCounters(p, prt);
    updateBottomBar(p, prt);
    mountLiveDiagram();
  }

  /* ================================================================== *
   * 13b. Render — craft project (#screen-craft)
   * ================================================================== */

  function updateCraftTimerChip(p) {
    if (!els.cTimer) return;
    var text = fmtDuration(Store.elapsedMs(p));
    els.cTimer.textContent = text;
    var running = !!(p.timer && p.timer.runningSince);
    els.cTimer.classList.toggle('running', running);
    els.cTimer.setAttribute('aria-label', (running ? 'Stop' : 'Start') + ' timer, ' + text);
  }

  /** The friendly card a project gets when its craft module is not loaded. */
  function craftMissingCard(p) {
    var info = craftInfo(p.craft);
    var card = el('section', 'card craft-missing');
    card.appendChild(el('div', 'craft-missing-emoji', info.emoji));
    card.appendChild(el('h2', 'craft-missing-title', 'This project needs the ' + info.name + ' module'));
    card.appendChild(
      el(
        'p',
        'muted',
        'Its counting screen lives in a file that has not loaded. Nothing is lost — open the app ' +
          'online once so it can be cached, then come back.'
      )
    );
    var back = button('btn primary block', 'Back to projects');
    on(back, 'click', goHome);
    card.appendChild(back);
    return card;
  }

  function renderCraftProject(p) {
    if (!els.craftBody) return;
    if (els.cEmoji) els.cEmoji.textContent = p.emoji;
    if (els.cName) els.cName.textContent = p.name;
    updateCraftTimerChip(p);

    var def = craftFor(p);

    // Switching craft or project: the old screen gets torn down first.
    if (activeCraft && (activeCraft.id !== p.craft || activeCraft.projectId !== p.id)) {
      destroyCraftProject();
    }

    if (!def || typeof def.renderProject !== 'function') {
      destroyCraftProject();
      clear(els.craftBody);
      els.craftBody.appendChild(craftMissingCard(p));
      return;
    }

    if (!activeCraft) {
      clear(els.craftBody);
      activeCraft = { id: p.craft, projectId: p.id, def: def };
    }

    try {
      def.renderProject(p, els.craftBody, ctx);
    } catch (e) {
      destroyCraftProject();
      clear(els.craftBody);
      els.craftBody.appendChild(craftMissingCard(p));
    }
  }

  function destroyCraftProject() {
    if (!activeCraft) return;
    var def = activeCraft.def;
    activeCraft = null;
    if (def && typeof def.destroyProject === 'function') {
      try { def.destroyProject(); } catch (e) { /* ignore */ }
    }
    if (els.craftBody) clear(els.craftBody);
  }

  /* ================================================================== *
   * 14. Applying Store results (feedback, toasts, celebrations)
   * ================================================================== */

  function flashStitchButton() {
    if (!els.stitchBtn) return;
    els.stitchBtn.classList.remove('flash');
    // force reflow so the animation restarts
    void els.stitchBtn.offsetWidth;
    els.stitchBtn.classList.add('flash');
    window.setTimeout(function () {
      els.stitchBtn.classList.remove('flash');
    }, 500);
  }

  function showProjectDoneSheet(p) {
    openSheet({
      title: 'All parts done! 🎉',
      build: function (body) {
        body.appendChild(el('p', null, p.name + ' is off the hook. Time for assembly.'));
        var b = button('btn primary block big', 'Assembly checklist →');
        on(b, 'click', function () {
          closeAllSheets();
          openChecklistSheet(p.id);
        });
        body.appendChild(b);
      }
    });
  }

  function applyResult(res) {
    if (!res || res.event === 'none') return;
    var p = currentProject();
    if (!p) return;
    var prt = Store.activePart(p);

    switch (res.event) {
      case 'stitch':
        fb('tap');
        updateCounters(p, prt);
        pushDiagram('stitch');
        break;

      case 'group':
        fb('group');
        updateCounters(p, prt);
        pushDiagram('stitch');
        break;

      case 'alert':
        fb('alert');
        flashStitchButton();
        updateCounters(p, prt);
        pushDiagram('stitch');
        toast('Stitch ' + res.stitch + ' — check your pattern');
        break;

      case 'row':
      case 'rowAuto':
        fb('row');
        updateCounters(p, prt);
        updateBottomBar(p, prt);
        pushDiagram('round');
        announce(rowWord(p) + ' ' + prt.row);
        break;

      case 'pieceDone':
        fb('done');
        celebrate('piece');
        render();
        announce(res.partName + ' ' + res.piecesDone + ' of ' + res.makeCount + ' done');
        toast(res.partName + ' ' + res.piecesDone + ' of ' + res.makeCount + ' done! Starting ' +
          res.partName.toLowerCase() + ' ' + (res.piecesDone + 1) + '.', { ms: 3600 });
        break;

      case 'partDone':
        fb('done');
        celebrate('part');
        render();
        announce(res.partName + ' complete');
        toast(res.partName + ' complete ✓', { ms: 3600 });
        break;

      case 'projectDone':
        fb('done');
        Store.setStatus(p.id, 'finished');
        celebrate('project');
        render();
        announce('Project complete');
        showProjectDoneSheet(p);
        break;

      default:
        updateCounters(p, prt);
        pushDiagram('none');
    }
    // The fast paths above skip updateBottomBar; a tap is undoable at once.
    if (els.btnUndo) els.btnUndo.disabled = !Store.canUndo();
  }

  /* ================================================================== *
   * 15. Stitch button gesture
   * ================================================================== */

  /**
   * One finger, two gestures.
   *
   * Press and release inside the tolerance = one stitch, counted on
   * `pointerup` so nothing has to be taken back. Move further than the
   * tolerance and the press turns into a drag that spins the live 3D piece
   * instead; lifting after a drag counts nothing. Undo is never part of the
   * gesture — the old "count on down, Store.undo() if the finger moved" dance
   * made a scroll look like a glitch.
   *
   * The tap path is still synchronous: Store, DOM and the diagram are all
   * updated inside the pointerup handler (~0.2 ms), so the number changes in
   * the same frame the finger lifts.
   */
  var tapState = null;
  var MOVE_TOLERANCE_SQ = 12 * 12;

  function doStitchTap() {
    var p = currentProject();
    if (!p) return false;
    var prt = Store.activePart(p);
    if (!prt) return false;
    applyResult(Store.tapStitch(p.id, prt.id));
    return true;
  }

  function bindStitchButton() {
    var btn = els.stitchBtn;
    if (!btn) return;

    function releaseCapture() {
      if (!tapState) return;
      try {
        btn.releasePointerCapture(tapState.id);
      } catch (err) {
        /* ignore */
      }
    }

    function end() {
      btn.classList.remove('pressed');
      if (tapState && tapState.dragging) diagramDragEnd();
      releaseCapture();
      tapState = null;
    }

    on(btn, 'pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!currentProject()) return;
      // A second finger on the button is ignored; there is nothing to pinch.
      if (tapState) return;
      tapState = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, dragging: false };
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      btn.classList.add('pressed');
      e.preventDefault();
    });

    on(btn, 'pointermove', function (e) {
      if (!tapState || e.pointerId !== tapState.id) return;
      if (!tapState.dragging) {
        var dx = e.clientX - tapState.x;
        var dy = e.clientY - tapState.y;
        if (dx * dx + dy * dy <= MOVE_TOLERANCE_SQ) return;
        // Past the tolerance: this is a swipe, not a stitch.
        tapState.dragging = true;
        btn.classList.remove('pressed');
        diagramDragStart();
      }
      diagramDragMove(e.clientX - tapState.lx, e.clientY - tapState.ly);
      tapState.lx = e.clientX;
      tapState.ly = e.clientY;
      e.preventDefault();
    });

    on(btn, 'pointerup', function (e) {
      if (!tapState || e.pointerId !== tapState.id) return;
      var counted = !tapState.dragging;
      end();
      if (counted) doStitchTap();
    });

    on(btn, 'pointercancel', function (e) {
      if (tapState && e.pointerId !== tapState.id) return;
      end();
    });
    on(btn, 'contextmenu', function (e) {
      e.preventDefault();
    });
    // Keyboard activation (Enter/Space) produces a click with detail === 0.
    on(btn, 'click', function (e) {
      if (e.detail === 0) doStitchTap();
    });
  }

  /* ================================================================== *
   * 15b. Live 3D diagram
   *
   * Entirely optional: without window.Diagram (or with the setting off) no
   * canvas is created and every entry point below is a no-op, so the counter
   * behaves exactly as it did before.
   * ================================================================== */

  var live = { handle: null, canvas: null, btn: null };
  var viewer = { handle: null, canvas: null, readout: null, sheet: null };

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function diagramAvailable() {
    return !!(
      window.Diagram &&
      typeof window.Diagram.mount === 'function' &&
      window.Store &&
      typeof Store.diagramModel === 'function'
    );
  }

  function diagramEnabled() {
    return diagramAvailable() && Store.settings().liveDiagram !== false;
  }

  /** '#4a3728' / 'rgb(…)' → 'rgba(74,55,40,a)'. Unparseable colours pass through. */
  function withAlpha(color, a) {
    var c = String(color || '').trim();
    if (!c) return 'rgba(0,0,0,' + a + ')';
    var hex = c.charAt(0) === '#' ? c.slice(1) : null;
    if (hex && hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) {
      return (
        'rgba(' + parseInt(hex.slice(0, 2), 16) + ',' + parseInt(hex.slice(2, 4), 16) + ',' +
        parseInt(hex.slice(4, 6), 16) + ',' + a + ')'
      );
    }
    var m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var parts = m[1].split(',');
      if (parts.length >= 3) {
        return 'rgba(' + parts[0].trim() + ',' + parts[1].trim() + ',' + parts[2].trim() + ',' + a + ')';
      }
    }
    return c;
  }

  function cssVar(cs, name, fallback) {
    var v = (cs.getPropertyValue(name) || '').trim();
    return v || fallback;
  }

  function diagramPalette() {
    var cs = window.getComputedStyle(document.documentElement);
    return {
      ghost: withAlpha(cssVar(cs, '--text', '#000000'), 0.35),
      ink: cssVar(cs, '--primary-text', '#ffffff'),
      glow: cssVar(cs, '--accent-2', '#e6a23c'),
      bg: cssVar(cs, '--primary', '#4f9868')
    };
  }

  /** The model for whatever is on screen, or null. */
  function currentModel() {
    var p = currentProject();
    var prt = p ? Store.activePart(p) : null;
    if (!p || !prt) return null;
    try {
      return Store.diagramModel(prt, p);
    } catch (e) {
      return null;
    }
  }

  /**
   * Push the current model at whatever is mounted.
   * @param {'stitch'|'round'|'none'} animate
   */
  function pushDiagram(animate) {
    if (!live.handle && !viewer.handle) return;
    var model = currentModel();
    if (!model) return;
    var opts = { animate: animate || 'none' };
    if (live.handle) {
      try {
        live.handle.setModel(model, opts);
      } catch (e) {
        /* a renderer that gave up must not break counting */
      }
    }
    if (viewer.handle) {
      try {
        viewer.handle.setModel(model, opts);
      } catch (e) {
        /* ignore */
      }
      updateViewerReadout();
    }
  }

  function setDiagramPalette() {
    var pal = null;
    [live.handle, viewer.handle].forEach(function (h) {
      if (!h || typeof h.setPalette !== 'function') return;
      if (!pal) pal = diagramPalette();
      try {
        h.setPalette(pal);
      } catch (e) {
        /* ignore */
      }
    });
  }

  /* ---- Swipe-to-rotate for the button ----
   * The canvas under the stitch button is `pointer-events: none` (the button
   * has to keep every tap), so the button's own pointer handlers drive the
   * renderer through its drag API. Same code path as the viewer sheet's
   * pointer handling, so both turn the piece the same way.
   */
  function diagramDragStart() {
    if (live.handle && typeof live.handle.dragStart === 'function') {
      try {
        live.handle.dragStart();
      } catch (e) {
        /* ignore */
      }
    }
  }

  function diagramDragMove(dx, dy) {
    if (live.handle && typeof live.handle.dragMove === 'function') {
      try {
        live.handle.dragMove(dx, dy);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function diagramDragEnd() {
    if (live.handle && typeof live.handle.dragEnd === 'function') {
      try {
        live.handle.dragEnd();
      } catch (e) {
        /* ignore */
      }
    }
  }

  function resizeDiagrams() {
    [live.handle, viewer.handle].forEach(function (h) {
      if (!h || typeof h.resize !== 'function') return;
      try {
        h.resize();
      } catch (e) {
        /* ignore */
      }
    });
  }

  function destroyLiveDiagram() {
    if (live.handle) {
      try {
        live.handle.destroy();
      } catch (e) {
        /* ignore */
      }
      live.handle = null;
    }
    if (live.canvas && live.canvas.parentNode) live.canvas.parentNode.removeChild(live.canvas);
    live.canvas = null;
    if (live.btn && live.btn.parentNode) live.btn.parentNode.removeChild(live.btn);
    live.btn = null;
    if (els.stitchBtn) els.stitchBtn.classList.remove('has-diagram');
  }

  /** Mount (or refresh) the canvas inside the stitch button. */
  function mountLiveDiagram() {
    if (!diagramEnabled() || !els.stitchBtn) {
      destroyLiveDiagram();
      return;
    }
    if (!live.canvas) {
      var c = document.createElement('canvas');
      c.id = 'stitch-canvas';
      c.className = 'stitch-canvas';
      c.setAttribute('aria-hidden', 'true');
      // Behind the caption and the number, which the CSS lifts above it.
      els.stitchBtn.insertBefore(c, els.stitchBtn.firstChild);
      live.canvas = c;
    }
    if (!live.handle) {
      try {
        live.handle = window.Diagram.mount(live.canvas, {
          palette: diagramPalette(),
          reducedMotion: prefersReducedMotion(),
          interactive: false
        });
      } catch (e) {
        live.handle = null;
      }
      if (!live.handle) {
        destroyLiveDiagram();
        return;
      }
      // Handy for measuring from the console (handle.getStats()); nothing in
      // the app reads it back.
      live.canvas.diagram = live.handle;
    }
    if (!live.btn && els.stitchSection) {
      var b = button('stitch-3d', '⤢', 'Open 3D view');
      b.id = 'stitch-3d';
      on(b, 'click', function (e) {
        e.stopPropagation();
        openViewerSheet();
      });
      els.stitchSection.appendChild(b);
      live.btn = b;
    }
    els.stitchBtn.classList.add('has-diagram');
    resizeDiagrams();
    pushDiagram('none');
  }

  /** "Rnd 5 · 13 / 24" for the viewer header. */
  function viewerReadoutText(p, prt) {
    if (!p || !prt) return '';
    var ri = Store.repeatInfo(prt);
    var target = Store.currentTarget(prt);
    var text = shortRowWord(p) + ' ' + ri.workingRow + ' · ' + prt.stitch;
    text += target ? ' / ' + target : ' sts';
    return text;
  }

  function updateViewerReadout() {
    if (!viewer.readout) return;
    var p = currentProject();
    var prt = p ? Store.activePart(p) : null;
    viewer.readout.textContent = viewerReadoutText(p, prt);
  }

  function destroyViewer() {
    if (viewer.handle) {
      try {
        viewer.handle.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    viewer.handle = null;
    viewer.canvas = null;
    viewer.readout = null;
    viewer.sheet = null;
  }

  function openViewerSheet() {
    var p = currentProject();
    var prt = p ? Store.activePart(p) : null;
    if (!p || !prt) return;

    openSheet({
      title: prt.name,
      cls: 'sheet-viewer',
      build: function (body, api) {
        viewer.sheet = api;

        // The round / stitch readout lives in the sheet header, beside the name.
        var readout = el('div', 'viewer-readout', viewerReadoutText(p, prt));
        viewer.readout = readout;
        var head = api.dialog.querySelector('.sheet-head');
        if (head) {
          var closeBtn = head.querySelector('.sheet-close');
          if (closeBtn) head.insertBefore(readout, closeBtn);
          else head.appendChild(readout);
        } else {
          body.appendChild(readout);
        }

        var stage = el('div', 'viewer-stage');
        var canvas = document.createElement('canvas');
        canvas.className = 'viewer-canvas';
        canvas.setAttribute('aria-label', prt.name + ' in 3D');
        stage.appendChild(canvas);
        body.appendChild(stage);

        if (!diagramAvailable()) {
          stage.appendChild(el('div', 'viewer-empty', 'The 3D view is not available on this device.'));
          return;
        }
        try {
          viewer.handle = window.Diagram.mount(canvas, {
            palette: diagramPalette(),
            reducedMotion: prefersReducedMotion(),
            interactive: true
          });
        } catch (e) {
          viewer.handle = null;
        }
        if (!viewer.handle) {
          stage.appendChild(el('div', 'viewer-empty', 'The 3D view could not start.'));
          return;
        }
        viewer.canvas = canvas;
        canvas.diagram = viewer.handle;
        if (typeof viewer.handle.setInteractive === 'function') {
          try {
            viewer.handle.setInteractive(true);
          } catch (e2) {
            /* ignore */
          }
        }
        // The sheet is still animating in — size it once it has landed.
        window.requestAnimationFrame(function () {
          resizeDiagrams();
          pushDiagram('none');
        });
      },
      footer: [
        {
          text: 'Yarn colours',
          cls: 'btn ghost',
          onClick: function () {
            openYarnSheet(p.id);
          }
        },
        {
          text: 'Close',
          cls: 'btn primary',
          onClick: function (api) {
            api.close();
          }
        }
      ],
      onClose: destroyViewer
    });
  }

  /* ---- Yarn colours ---- */

  function yarnRow(projectId, name, label) {
    var proj = Store.project(projectId);
    var row = el('div', 'yarn-row');
    var swatch = el('span', 'yarn-swatch');
    var main = el('div', 'yarn-main');
    main.appendChild(el('div', 'yarn-name', label));
    var reset = button('linkish yarn-reset', 'Reset to detected');
    main.appendChild(reset);

    var pick = document.createElement('input');
    pick.type = 'color';
    pick.className = 'yarn-pick';
    pick.setAttribute('aria-label', label + ' colour');

    function sync() {
      var hex = Store.yarnColorFor(Store.project(projectId), name);
      swatch.style.background = hex;
      pick.value = hex;
      reset.hidden = !Store.hasYarnColor(Store.project(projectId), name);
    }

    function apply(hex) {
      Store.setYarnColor(projectId, name, hex);
      sync();
      // Both the button and the viewer follow the new palette straight away.
      pushDiagram('none');
    }

    on(pick, 'input', function () {
      apply(pick.value);
    });
    on(pick, 'change', function () {
      apply(pick.value);
    });
    on(reset, 'click', function () {
      apply(null);
      fb('tap');
    });

    row.appendChild(swatch);
    row.appendChild(main);
    row.appendChild(pick);
    if (proj) sync();
    return row;
  }

  function openYarnSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    openSheet({
      title: 'Yarn colours',
      build: function (body) {
        var list = el('div', 'list');
        list.appendChild(yarnRow(p.id, Store.MAIN_YARN || '*', 'Main yarn'));

        var names = [];
        try {
          names = Store.yarnColorNames(p) || [];
        } catch (e) {
          names = [];
        }
        names.forEach(function (n) {
          list.appendChild(yarnRow(p.id, n, n));
        });
        body.appendChild(list);

        body.appendChild(
          el(
            'div',
            'field-hint',
            names.length
              ? 'Colours picked up from your pattern. Change one and the 3D piece changes with it.'
              : 'No colour names found in this pattern yet — the main yarn colours the whole piece.'
          )
        );
      }
    });
  }

  /* ================================================================== *
   * 16. Project / part editors
   * ================================================================== */

  function templatePreview(tpl) {
    return tpl.parts
      .map(function (p) { return p.name + (p.makeCount > 1 ? ' ×' + p.makeCount : ''); })
      .join(', ');
  }

  function openProjectEditor(projectId) {
    var editing = !!projectId;
    var p = editing ? Store.project(projectId) : null;
    if (editing && !p) return;

    var chosenTemplate = 'blank';
    var chosenCraft = p ? p.craft || 'crochet' : 'crochet';
    var nameInput, notesArea, emoji, modeSeg, groupStep;
    var modeField, groupField, craftFieldsWrap, craftFieldsApi, pdfHint;

    /* Rows/Rounds and the stitch group size only mean something to crochet. */
    function syncCraftOnlyFields() {
      var crochet = chosenCraft === 'crochet';
      if (modeField) modeField.hidden = !crochet;
      if (groupField) groupField.hidden = !crochet;
      if (pdfHint) pdfHint.hidden = !crochet;
    }

    function mountCraftFields() {
      if (!craftFieldsWrap) return;
      clear(craftFieldsWrap);
      craftFieldsApi = null;
      var def = craftDefs[chosenCraft];
      if (!def || typeof def.newProjectFields !== 'function') return;
      try {
        craftFieldsApi = def.newProjectFields(craftFieldsWrap, ctx) || null;
      } catch (e) {
        clear(craftFieldsWrap);
        craftFieldsApi = null;
      }
    }

    openSheet({
      title: editing ? 'Edit project' : 'New project',
      build: function (body, api) {
        nameInput = textInput(p ? p.name : '', 'Sunny the sheep');
        body.appendChild(field('Name', nameInput));

        emoji = emojiGrid(p ? p.emoji : '🧶');
        body.appendChild(field('Emoji', emoji.node));

        // Crafts: pickable on a new project, a read-only tag afterwards.
        if (multiCraft()) {
          if (editing) {
            var info = craftInfo(chosenCraft);
            var tag = el('div', 'craft-tag');
            tag.appendChild(el('span', 'craft-tag-emoji', info.emoji));
            tag.appendChild(el('span', null, info.name));
            body.appendChild(field('Craft', tag, 'A project keeps the craft it was made with.'));
          } else {
            var craftSeg = segmented(
              craftList().map(function (c) { return { id: c.id, label: c.emoji + ' ' + c.name }; }),
              chosenCraft,
              function (id) {
                chosenCraft = id;
                syncCraftOnlyFields();
                mountCraftFields();
                if (typeof renderTemplatePicker === 'function') renderTemplatePicker();
              }
            );
            craftSeg.node.classList.add('craft-seg');
            body.appendChild(field('Craft', craftSeg.node));
          }
        }

        if (!editing) {
          var grid = el('div', 'tpl-grid');

          var renderTemplatePicker = function () {
            clear(grid);
            var list = Store.templates(chosenCraft);
            if (!list.length) {
              grid.appendChild(el('p', 'muted', 'No templates yet.'));
              return;
            }
            // The chosen template may have just been deleted in the editor, or
            // belong to the craft we just switched away from.
            var chosen = Store.template(chosenTemplate);
            if (!chosen || (chosen.craft || 'crochet') !== chosenCraft) {
              chosenTemplate = list[0].id;
              // Switching craft auto-picks its first template, so the emoji
              // follows too (a sewing project should not start out as 🧶).
              if (emoji) emoji.set(list[0].emoji);
              if (modeSeg) modeSeg.set(list[0].countMode);
              if (groupStep) groupStep.set(list[0].groupSize);
            }
            list.forEach(function (tpl) {
              var card = button('tpl-card' + (tpl.id === chosenTemplate ? ' on' : ''));
              card.appendChild(el('span', 'tpl-emoji', tpl.emoji));
              var main = el('div', 'tpl-main');
              main.appendChild(el('div', 'tpl-name', tpl.name));
              main.appendChild(el('div', 'tpl-parts', templatePreview(tpl)));
              card.appendChild(main);
              on(card, 'click', function () {
                chosenTemplate = tpl.id;
                Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove('on'); });
                card.classList.add('on');
                if (!nameInput.value.trim()) nameInput.placeholder = tpl.name;
                // The template carries an emoji, a count mode and a group size.
                if (emoji) emoji.set(tpl.emoji);
                if (modeSeg) modeSeg.set(tpl.countMode);
                if (groupStep) groupStep.set(tpl.groupSize);
              });
              grid.appendChild(card);
            });
          };

          renderTemplatePicker();
          body.appendChild(field('Template', grid));

          var editRow = el('div', 'tpl-edit-link');
          var editLink = button('linkish', 'Edit templates');
          on(editLink, 'click', function () {
            openTemplatesSheet(renderTemplatePicker);
          });
          editRow.appendChild(editLink);
          body.appendChild(editRow);
        }

        modeSeg = segmented(
          [{ id: 'rows', label: 'Rows' }, { id: 'rounds', label: 'Rounds' }],
          p ? p.countMode : 'rows'
        );
        modeField = field('Count', modeSeg.node);
        body.appendChild(modeField);

        groupStep = stepper(p ? p.groupSize : 10, 0, 50, 'group size');
        groupField =
          field('Stitch group size', groupStep.node, 'A buzz every N stitches while you count. 0 = no grouping.');
        body.appendChild(groupField);

        // Craft-specific new-project fields go here.
        if (!editing) {
          craftFieldsWrap = el('div', 'craft-fields');
          body.appendChild(craftFieldsWrap);
          mountCraftFields();
        }

        notesArea = textArea(p ? p.notes : '', '', 'Hook 4mm · Paintbox DK · pattern link…');
        body.appendChild(field('Notes', notesArea));

        if (!editing) {
          pdfHint = el('p', 'pdf-hint', PDF_HINT);
          body.appendChild(pdfHint);
        }

        syncCraftOnlyFields();

        if (editing) {
          var zone = el('div', 'danger-zone');
          var del = button('btn danger block', 'Delete project');
          on(del, 'click', function () {
            confirmSheet({
              title: 'Delete ' + p.name + '?',
              message: 'Rows, parts, notes and history go with it. You get 6 seconds to undo.',
              confirmText: 'Delete',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              api.close();
              deleteProjectFlow(p.id);
            });
          });
          zone.appendChild(del);
          body.appendChild(zone);
        }
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save',
          cls: 'btn primary',
          onClick: function (api) {
            var patch = {
              name: nameInput.value,
              emoji: emoji.get(),
              countMode: modeSeg.get(),
              groupSize: groupStep.get(),
              notes: notesArea.value
            };
            if (editing) {
              Store.updateProject(p.id, patch);
            } else {
              patch.templateId = chosenTemplate;
              patch.craft = chosenCraft;
              // Whatever the craft's own new-project fields collected.
              var seed = null;
              if (craftFieldsApi && typeof craftFieldsApi.get === 'function') {
                try { seed = craftFieldsApi.get(); } catch (e) { seed = null; }
              }
              patch.craftData = seed && typeof seed === 'object' ? seed : {};
              var created = Store.createProject(patch);
              Store.setActiveProject(created.id);
            }
            api.close();
            render();
          }
        }
      ]
    });
  }

  /* The undo window is 6 seconds; only once it has passed do the project's
     BlobStore entries (chart page images and friends) actually go. */
  var DELETE_UNDO_MS = 6000;

  function deleteProjectFlow(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var name = p.name;
    var undone = false;
    Store.deleteProject(projectId);
    render();
    toast('Deleted “' + name + '”.', {
      ms: DELETE_UNDO_MS,
      actionText: 'Undo',
      onAction: function () {
        undone = true;
        if (Store.undo()) {
          fb('undo');
          render();
        }
      }
    });
    window.setTimeout(function () {
      if (undone) return;
      // Undone through the bottom bar rather than the toast, or re-imported.
      if (Store.project(projectId)) return;
      if (!window.BlobStore || typeof window.BlobStore.deletePrefix !== 'function') return;
      try {
        window.BlobStore.deletePrefix('p:' + projectId + ':');
      } catch (e) {
        /* the images just stay; nothing the user can see */
      }
    }, DELETE_UNDO_MS + 400);
  }

  function addPartFlow(projectId) {
    var nameInput, countStep;
    openSheet({
      title: 'Add a part',
      build: function (body) {
        nameInput = textInput('', 'Wing');
        body.appendChild(field('Name', nameInput));
        countStep = stepper(1, 1, 20, 'make count');
        body.appendChild(field('How many', countStep.node, 'Wings ×2, legs ×4 — the counter tracks each piece.'));
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Add',
          cls: 'btn primary',
          onClick: function (api) {
            Store.addPart(projectId, { name: nameInput.value, makeCount: countStep.get() });
            api.close();
            render();
          }
        }
      ]
    });
  }

  function openPartEditor(projectId, partId) {
    var p = Store.project(projectId);
    var prt = Store.part(p, partId);
    if (!p || !prt) return;

    var nameInput, makeStep, targetInput, repEnable, repStart, repEnd, repTimes,
      alertsInput, placeArea, patternArea, extras;
    var repeatOn = !!prt.repeat.enabled;
    var sizeIndex = prt.sizeIndex || 0;

    /** A part-shaped object so the Store can parse the unsaved textarea. */
    function previewPart() {
      return { id: prt.id + ':preview', patternText: patternArea.value, sizeIndex: sizeIndex };
    }

    function collectPatch() {
      return {
        name: nameInput.value,
        makeCount: makeStep.get(),
        targetRows: targetInput.value === '' ? null : targetInput.value,
        repeat: {
          enabled: repeatOn,
          startRow: repStart.value,
          endRow: repEnd.value,
          times: repTimes.value
        },
        alerts: parseNumberList(alertsInput.value),
        placementNotes: placeArea.value,
        patternText: patternArea.value,
        sizeIndex: sizeIndex
      };
    }

    function syncRepeatSwitch() {
      var sw = repEnable ? repEnable.querySelector('.switch') : null;
      if (sw) sw.setAttribute('aria-checked', repeatOn ? 'true' : 'false');
    }

    function summaryLine(s, tmp) {
      var bits = [];
      if (!s.rows) {
        bits.push('No numbered ' + rowWord(p).toLowerCase() + 's found yet');
      } else {
        bits.push(
          s.rows + ' ' + rowWord(p).toLowerCase() + (s.rows === 1 ? '' : 's') +
          (s.maxRow ? ' (up to ' + s.maxRow + ')' : '')
        );
        if (!s.hasTargets) bits.push('no stitch counts');
        else if (s.computedOnly) bits.push('counts computed ≈');
        else bits.push('stitch counts found');
      }
      if (s.sections && s.sections.length > 1) bits.push(s.sections.length + ' sections detected');
      var sizeNames = (s.sizes && s.sizes.length) ? s.sizes : (p.sizes && p.sizes.length ? p.sizes : null);
      if (sizeNames) {
        bits.push('sizes: ' + sizeNames.join(', '));
      } else if (s.multiSize) {
        var n = Store.sizeCount(tmp);
        if (n > 1) bits.push(n + ' sizes');
      }
      return bits.join(' · ');
    }

    function suggestedTimes(r) {
      var len = r.endRow - r.startRow + 1;
      var t = typeof r.times === 'number' && r.times > 0 ? Math.floor(r.times) : null;
      if (t === null && typeof r.untilRows === 'number' && r.untilRows > 0 && len > 0) {
        t = Math.floor((r.untilRows - r.startRow + 1) / len);
      }
      return Math.max(1, t || 1);
    }

    function suggestionBits(sug) {
      var out = [];
      if (sug.targetRows) {
        out.push('Target ' + rowWord(p).toLowerCase() + 's: ' + sug.targetRows);
      }
      var r = sug.repeat;
      if (r && r.startRow && r.endRow && r.endRow >= r.startRow) {
        out.push(
          'Repeat ' + rowWord(p).toLowerCase() + 's ' + r.startRow + '–' + r.endRow +
          ' × ' + suggestedTimes(r)
        );
      }
      return out;
    }

    function applyDetected(sug) {
      var bits = suggestionBits(sug);
      confirmSheet({
        title: 'Apply detected settings?',
        message: 'This will set — ' + bits.join('; ') + '.',
        confirmText: 'Apply'
      }).then(function (ok) {
        if (!ok) return;
        Store.applySuggestions(p.id, prt.id, sug);
        targetInput.value = prt.targetRows == null ? '' : String(prt.targetRows);
        repStart.value = String(prt.repeat.startRow);
        repEnd.value = String(prt.repeat.endRow);
        repTimes.value = String(prt.repeat.times);
        repeatOn = !!prt.repeat.enabled;
        syncRepeatSwitch();
        toast('Applied: ' + bits.join(' · '));
      });
    }

    function refreshParsed() {
      if (!extras) return;
      clear(extras);
      if (!patternArea.value.trim()) {
        extras.appendChild(
          el('div', 'parsed-note', 'Paste the pattern for this part to get row highlighting and stitch targets.')
        );
        return;
      }
      var tmp = previewPart();
      var s = Store.patternSummary(tmp);
      extras.appendChild(el('div', 'parsed-note', summaryLine(s, tmp)));

      /* ---- Size picker ---- */
      var pickerNames = (s.sizes && s.sizes.length) ? s.sizes : (p.sizes && p.sizes.length ? p.sizes : null);
      if (pickerNames || s.multiSize) {
        var n = Math.max(Store.sizeCount(tmp), pickerNames ? pickerNames.length : 0, 1);
        if (n > 1) {
          var sel = document.createElement('select');
          for (var i = 0; i < n; i++) {
            var opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = pickerNames && pickerNames[i] ? pickerNames[i] : 'Size ' + (i + 1);
            sel.appendChild(opt);
          }
          sel.value = String(Math.min(sizeIndex, n - 1));
          sizeIndex = parseInt(sel.value, 10) || 0;
          on(sel, 'change', function () {
            sizeIndex = parseInt(sel.value, 10) || 0;
            refreshParsed();
          });
          extras.appendChild(field('Size', sel, 'Multi-size counts use this size.'));
        }
      }

      /* ---- Detected settings ---- */
      var sug = s.suggestions;
      if (sug && suggestionBits(sug).length) {
        var applyBtn = button('btn block', '✨ Apply detected settings');
        on(applyBtn, 'click', function () {
          applyDetected(sug);
        });
        extras.appendChild(applyBtn);
      }

      /* ---- Multi-section hint ---- */
      if (s.sections && s.sections.length > 1) {
        var hint = el('div', 'field-hint');
        hint.appendChild(
          document.createTextNode('This text has ' + s.sections.length + ' sections — use ')
        );
        var link = button('linkish', 'Import pattern');
        on(link, 'click', function () {
          Store.updatePart(p.id, prt.id, collectPatch());
          closeAllSheets();
          render();
          openImportSheet(p.id, patternArea.value);
        });
        hint.appendChild(link);
        hint.appendChild(document.createTextNode(' to split it into parts.'));
        extras.appendChild(hint);
      }
    }

    openSheet({
      title: 'Part: ' + prt.name,
      build: function (body, api) {
        nameInput = textInput(prt.name, 'Body');
        body.appendChild(field('Name', nameInput));

        makeStep = stepper(prt.makeCount, 1, 20, 'make count');
        body.appendChild(field('How many', makeStep.node));

        targetInput = numInput(prt.targetRows == null ? '' : prt.targetRows, 1, 999999, 'e.g. 40');
        body.appendChild(field('Target ' + rowWord(p).toLowerCase() + 's', targetInput, 'Leave blank for open-ended.'));

        // Repeat
        var repWrap = el('div', 'field');
        repWrap.appendChild(el('div', 'field-label', 'Repeat section'));
        repEnable = switchRow('Enable repeat', 'Loop a block of rows several times.', repeatOn, function (v) {
          repeatOn = v;
        });
        repWrap.appendChild(repEnable);
        var repRow = el('div', 'row-flex');
        repStart = numInput(prt.repeat.startRow, 1, 999999);
        repEnd = numInput(prt.repeat.endRow, 1, 999999);
        repTimes = numInput(prt.repeat.times, 1, 9999);
        repRow.appendChild(field('From', repStart));
        repRow.appendChild(field('To', repEnd));
        repRow.appendChild(field('Times', repTimes));
        repWrap.appendChild(repRow);
        body.appendChild(repWrap);

        alertsInput = textInput(prt.alerts.join(', '), '40, 80');
        body.appendChild(field('Stitch alerts', alertsInput, 'Comma-separated stitch numbers to buzz at.'));

        placeArea = textArea(prt.placementNotes, '', 'Eyes between rnd 8–9, 6 sts apart');
        body.appendChild(field('Placement notes', placeArea));

        patternArea = textArea(prt.patternText, 'mono', 'Rnd 1: 6 sc in MR (6)\nRnd 2: inc x6 (12)');
        extras = el('div', 'pattern-extras');
        body.appendChild(field('Pattern text', patternArea));
        body.appendChild(extras);
        on(patternArea, 'input', debounce(refreshParsed, 250));
        refreshParsed();

        var zone = el('div', 'danger-zone');
        var reset = button('btn block', 'Reset counts');
        on(reset, 'click', function () {
          confirmSheet({
            title: 'Reset ' + prt.name + '?',
            message: 'Row and stitch go back to zero. Completed pieces are kept.',
            confirmText: 'Reset'
          }).then(function (ok) {
            if (!ok) return;
            Store.resetPart(p.id, prt.id);
            api.close();
            render();
            toast('Counts reset');
          });
        });
        zone.appendChild(reset);

        if (p.parts.length > 1) {
          var del = button('btn danger block', 'Delete part');
          on(del, 'click', function () {
            confirmSheet({
              title: 'Delete ' + prt.name + '?',
              message: 'Its rows, pattern and notes go too.',
              confirmText: 'Delete',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.deletePart(p.id, prt.id);
              api.close();
              render();
            });
          });
          zone.appendChild(del);
        }
        body.appendChild(zone);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save',
          cls: 'btn primary',
          onClick: function (api) {
            Store.updatePart(p.id, prt.id, collectPatch());
            api.close();
            render();
          }
        }
      ]
    });
  }

  function openPartsSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    openSheet({
      title: 'Parts',
      build: function (body, api) {
        var list = el('div', 'list');
        p.parts.forEach(function (prt) {
          var item = button('menu-item');
          var main = el('div');
          main.appendChild(el('div', null, prt.name + (prt.makeCount > 1 ? ' ×' + prt.makeCount : '')));
          var sub = shortRowWord(p) + ' ' + prt.row + (prt.targetRows ? ' / ' + prt.targetRows : '');
          if (prt.makeCount > 1) sub += ' · ' + prt.piecesDone + ' of ' + prt.makeCount + ' done';
          main.appendChild(el('div', 'toggle-sub', sub));
          item.appendChild(main);
          on(item, 'click', function () {
            api.close();
            Store.setActivePart(p.id, prt.id);
            render();
            openPartEditor(p.id, prt.id);
          });
          list.appendChild(item);
        });
        body.appendChild(list);

        var add = button('btn primary block', '＋ Add a part');
        on(add, 'click', function () {
          api.close();
          addPartFlow(p.id);
        });
        body.appendChild(add);
      }
    });
  }

  /* ================================================================== *
   * 16c. Templates (list + editor)
   * ================================================================== */

  function templateSub(tpl) {
    var bits = [tpl.parts.length + ' part' + (tpl.parts.length === 1 ? '' : 's')];
    if (tpl.checklist.length) {
      bits.push(tpl.checklist.length + ' checklist item' + (tpl.checklist.length === 1 ? '' : 's'));
    }
    return bits.join(' · ');
  }

  /**
   * The craft tag on a template card. Shown once there is more than one craft
   * to tell apart — or whenever a template is not a crochet one, even if that
   * craft's UI module has not loaded, so the list is never ambiguous.
   */
  function templateCraftTag(tpl) {
    var craft = tpl.craft || 'crochet';
    if (!multiCraft() && craft === 'crochet') return null;
    var info = craftInfo(craft);
    var tag = el('span', 'tpl-tag tpl-craft-tag', info.emoji + ' ' + info.name);
    tag.setAttribute('title', info.name);
    return tag;
  }

  /** In the template editor, the tag shows under the same rule. */
  function showTemplateCraft(craft) {
    return multiCraft() || (craft || 'crochet') !== 'crochet';
  }

  /** Renders the tap-to-edit template list into `container`. */
  function renderTemplateList(container, onChanged) {
    clear(container);
    var list = Store.templates();
    var userCount = 0;

    list.forEach(function (tpl) {
      if (!tpl.builtIn) userCount++;
      var item = button('menu-item tpl-item');
      item.setAttribute('aria-label', 'Edit template ' + tpl.name);
      item.appendChild(el('span', 'menu-icon', tpl.emoji));
      var main = el('span', 'tpl-item-main');
      main.appendChild(el('span', 'tpl-item-name', tpl.name));
      main.appendChild(el('span', 'tpl-item-sub', templateSub(tpl)));
      item.appendChild(main);
      var craftTag = templateCraftTag(tpl);
      if (craftTag) item.appendChild(craftTag);
      if (tpl.builtIn) item.appendChild(el('span', 'tpl-tag', 'Built-in'));
      on(item, 'click', function () {
        openTemplateEditor({
          id: tpl.id,
          onSaved: function () {
            renderTemplateList(container, onChanged);
            if (onChanged) onChanged();
          }
        });
      });
      container.appendChild(item);
    });

    if (!userCount) {
      container.appendChild(el('p', 'muted', 'Your saved templates will show up here.'));
    }
  }

  /** The Templates sheet: list + "＋ New template". */
  function openTemplatesSheet(onChanged) {
    openSheet({
      title: 'Templates',
      build: function (body) {
        var list = el('div', 'list');
        renderTemplateList(list, onChanged);
        body.appendChild(list);

        var add = button('btn primary block', '＋ New template');
        on(add, 'click', function () {
          openTemplateEditor({
            onSaved: function () {
              renderTemplateList(list, onChanged);
              if (onChanged) onChanged();
            }
          });
        });
        body.appendChild(add);
        body.appendChild(
          el('div', 'field-hint', 'Built-in templates can be edited and reset. Your own ones can be deleted.')
        );
      }
    });
  }

  /**
   * Template editor.
   * @param {{ id?:string, draft?:Object, onSaved?:Function }} opts
   */
  function openTemplateEditor(opts) {
    opts = opts || {};
    var source = opts.draft || (opts.id ? Store.template(opts.id) : null);
    if (!source) {
      source = {
        id: '',
        name: '',
        emoji: '🧶',
        countMode: 'rows',
        groupSize: 10,
        parts: [{ name: 'Main', makeCount: 1 }],
        checklist: [],
        builtIn: false
      };
    }

    var editingId = source.id || '';
    var isBuiltIn = !!source.builtIn;
    var templateCraft = source.craft || 'crochet';
    var model = {
      parts: (source.parts || []).map(function (p) {
        return { name: p.name, makeCount: p.makeCount };
      }),
      checklist: (source.checklist || []).slice()
    };
    if (!model.parts.length) model.parts.push({ name: '', makeCount: 1 });

    var nameInput, emoji, modeSeg, groupStep, partsWrap, checkWrap;
    var partRefs = [];
    var checkRefs = [];

    /** Pull the live input values back into the model before a re-render. */
    function syncModel() {
      partRefs.forEach(function (ref, i) {
        if (!model.parts[i]) return;
        model.parts[i].name = ref.name.value;
        model.parts[i].makeCount = ref.step.get();
      });
      checkRefs.forEach(function (inp, i) {
        if (i < model.checklist.length) model.checklist[i] = inp.value;
      });
    }

    function renderParts() {
      clear(partsWrap);
      partRefs = [];
      model.parts.forEach(function (p, i) {
        var row = el('div', 'tpl-part-row');

        var top = el('div', 'tpl-part-top');
        var nameIn = textInput(p.name, 'Body');
        nameIn.className = 'tpl-part-name';
        nameIn.setAttribute('aria-label', 'Part ' + (i + 1) + ' name');
        var del = button('tpl-mini', '✕', 'Remove part ' + (p.name || i + 1));
        on(del, 'click', function () {
          syncModel();
          model.parts.splice(i, 1);
          if (!model.parts.length) model.parts.push({ name: '', makeCount: 1 });
          renderParts();
        });
        top.appendChild(nameIn);
        top.appendChild(del);

        var bot = el('div', 'tpl-part-bot');
        bot.appendChild(el('span', 'tpl-mini-label', 'Make'));
        var step = stepper(p.makeCount, 1, 99, 'make count');
        step.input.setAttribute('aria-label', 'How many of part ' + (i + 1));
        bot.appendChild(step.node);
        var up = button('tpl-mini', '▲', 'Move part ' + (i + 1) + ' up');
        var down = button('tpl-mini', '▼', 'Move part ' + (i + 1) + ' down');
        up.disabled = i === 0;
        down.disabled = i === model.parts.length - 1;
        on(up, 'click', function () {
          syncModel();
          model.parts.splice(i - 1, 0, model.parts.splice(i, 1)[0]);
          renderParts();
        });
        on(down, 'click', function () {
          syncModel();
          model.parts.splice(i + 1, 0, model.parts.splice(i, 1)[0]);
          renderParts();
        });
        bot.appendChild(up);
        bot.appendChild(down);

        row.appendChild(top);
        row.appendChild(bot);
        partsWrap.appendChild(row);
        partRefs.push({ name: nameIn, step: step });
      });

      var add = button('btn block', '＋ Add part');
      on(add, 'click', function () {
        syncModel();
        model.parts.push({ name: '', makeCount: 1 });
        renderParts();
        var last = partRefs[partRefs.length - 1];
        if (last) last.name.focus();
      });
      partsWrap.appendChild(add);
    }

    function renderChecklist() {
      clear(checkWrap);
      checkRefs = [];
      model.checklist.forEach(function (text, i) {
        var row = el('div', 'tpl-check-row');
        var inp = textInput(text, 'Sew the tail on');
        inp.setAttribute('aria-label', 'Checklist item ' + (i + 1));
        var del = button('tpl-mini', '✕', 'Remove checklist item ' + (i + 1));
        on(del, 'click', function () {
          syncModel();
          model.checklist.splice(i, 1);
          renderChecklist();
        });
        row.appendChild(inp);
        row.appendChild(del);
        checkWrap.appendChild(row);
        checkRefs.push(inp);
      });
      if (!model.checklist.length) {
        checkWrap.appendChild(el('p', 'muted', 'No assembly steps yet.'));
      }
      var add = button('btn block', '＋ Add item');
      on(add, 'click', function () {
        syncModel();
        model.checklist.push('');
        renderChecklist();
        var last = checkRefs[checkRefs.length - 1];
        if (last) last.focus();
      });
      checkWrap.appendChild(add);
    }

    openSheet({
      title: editingId ? 'Edit template' : 'New template',
      build: function (body, api) {
        nameInput = textInput(source.name || '', 'Sheep');
        body.appendChild(field('Name', nameInput));

        emoji = emojiGrid(source.emoji || '🧶');
        body.appendChild(field('Emoji', emoji.node));

        // Crafts: which one this template belongs to, read-only.
        if (showTemplateCraft(templateCraft)) {
          var cInfo = craftInfo(templateCraft);
          var cTag = el('div', 'craft-tag');
          cTag.appendChild(el('span', 'craft-tag-emoji', cInfo.emoji));
          cTag.appendChild(el('span', null, cInfo.name));
          body.appendChild(field('Craft', cTag));
        }

        modeSeg = segmented(
          [{ id: 'rows', label: 'Rows' }, { id: 'rounds', label: 'Rounds' }],
          source.countMode === 'rounds' ? 'rounds' : 'rows'
        );
        var modeField = field('Count', modeSeg.node);
        body.appendChild(modeField);

        groupStep = stepper(typeof source.groupSize === 'number' ? source.groupSize : 10, 0, 50, 'group size');
        var groupField =
          field('Stitch group size', groupStep.node, 'New projects start with this group size. 0 = no grouping.');
        body.appendChild(groupField);

        // Rows/Rounds and group size are crochet-only.
        if (templateCraft !== 'crochet') {
          modeField.hidden = true;
          groupField.hidden = true;
        }

        partsWrap = el('div', 'tpl-parts-edit');
        body.appendChild(field('Parts', partsWrap, 'Wings ×2, legs ×4 — each piece is counted separately.'));
        renderParts();

        checkWrap = el('div', 'tpl-check-edit');
        body.appendChild(field('Assembly checklist', checkWrap));
        renderChecklist();

        var zone = el('div', 'danger-zone');
        if (isBuiltIn && editingId) {
          var reset = button('btn block', 'Reset to default');
          on(reset, 'click', function () {
            confirmSheet({
              title: 'Reset ' + (source.name || 'this template') + '?',
              message: 'It goes back to the parts and checklist it shipped with. Projects already made from it are untouched.',
              confirmText: 'Reset'
            }).then(function (ok) {
              if (!ok) return;
              Store.resetTemplate(editingId);
              api.close();
              toast('Template reset to default');
              if (opts.onSaved) opts.onSaved(null);
            });
          });
          zone.appendChild(reset);
        }
        if (!isBuiltIn && editingId) {
          var del = button('btn danger block', 'Delete template');
          on(del, 'click', function () {
            confirmSheet({
              title: 'Delete ' + (source.name || 'this template') + '?',
              message: 'Projects already made from it are untouched.',
              confirmText: 'Delete',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.deleteTemplate(editingId);
              api.close();
              toast('Template deleted');
              if (opts.onSaved) opts.onSaved(null);
            });
          });
          zone.appendChild(del);
        }
        if (zone.firstChild) body.appendChild(zone);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save',
          cls: 'btn primary',
          onClick: function (api) {
            syncModel();
            var saved;
            try {
              saved = Store.saveTemplate({
                id: editingId,
                name: nameInput.value,
                emoji: emoji.get(),
                countMode: modeSeg.get(),
                groupSize: groupStep.get(),
                parts: model.parts,
                checklist: model.checklist,
                craft: templateCraft
              });
            } catch (e) {
              toast(e && e.message ? e.message : 'That template is not valid');
              return;
            }
            api.close();
            toast('Saved “' + saved.name + '”');
            if (opts.onSaved) opts.onSaved(saved);
          }
        }
      ]
    });
  }

  /* ================================================================== *
   * 16b. Import pattern sheet
   * ================================================================== */

  var IMPORT_EMPTY =
    'No rows found yet. Paste the instruction part of your pattern ' +
    '(e.g. “Rnd 1: 6 sc in MR (6)”).';

  var PDF_HINT = 'Have a pattern PDF? Create the project, then use menu → Import pattern to drop it in.';

  function sectionRowInfo(text, seq) {
    var s = Store.patternSummary({ id: 'import:' + seq, patternText: text, sizeIndex: 0 });
    return { rows: s.rows, computedOnly: s.computedOnly, hasTargets: s.hasTargets };
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function isPdfFile(file) {
    if (!file) return false;
    if (file.type === 'application/pdf') return true;
    return /\.pdf$/i.test(file.name || '');
  }

  /** The first PDF out of a drop / file input, or the first file at all. */
  function firstFile(fileList) {
    if (!fileList || !fileList.length) return null;
    for (var i = 0; i < fileList.length; i++) {
      if (isPdfFile(fileList[i])) return fileList[i];
    }
    return fileList[0];
  }

  /* ================================================================== *
   * 16b. The reusable PDF drop zone (ctx.pdfDropZone)
   *
   * The dashed box, the hidden file input, "Reading page 3 of 21…" and the
   * non-PDF toast, factored out of the crochet Import sheet so craft modules
   * get exactly the same thing. The crochet sheet still uses it, so it stays
   * tested by the app itself.
   *
   *   pdfDropZone({
   *     label, linkText, icon, tour, ariaLabel, rejectMessage,
   *     accept: ['.pdf', '.oxs'],   // default PDF only
   *     confirm(file) -> boolean | Promise<boolean>,   // gate before reading
   *     onText(res),                // { text, pages, chars, columnsDetected }
   *     onPages(handle),            // PdfText.open handle, for page.render()
   *     onFile(file),               // a non-PDF file that matched `accept`
   *     onError(err)                // default: a toast
   *   }) -> HTMLElement   (with .zone, .setBusy, .showResult, .destroy on it)
   * ================================================================== */

  function fileHasExt(file, ext) {
    var name = String((file && file.name) || '').toLowerCase();
    var want = String(ext || '').toLowerCase();
    return !!want && name.length >= want.length && name.slice(-want.length) === want;
  }

  function pdfDropZone(opts) {
    opts = opts || {};
    var accept = Array.isArray(opts.accept) && opts.accept.length
      ? opts.accept.map(function (e) { return String(e).toLowerCase(); })
      : ['.pdf'];
    var wantsPdf = accept.indexOf('.pdf') >= 0;
    var reading = false;
    var docGuard = null;

    var wrap = el('div', 'dz-wrap');
    var zone = button('dz', null, opts.ariaLabel || 'Choose a pattern PDF');
    if (opts.tour) zone.setAttribute('data-tour', opts.tour);
    zone.appendChild(el('span', 'dz-icon', opts.icon || '📄'));

    var label = typeof opts.label === 'string' && opts.label
      ? opts.label
      : 'Drop a pattern PDF here, or choose a file';
    var linkText = typeof opts.linkText === 'string' && opts.linkText ? opts.linkText : 'choose a file';
    var line = el('span', 'dz-line');
    var at = label.lastIndexOf(linkText);
    if (at >= 0) {
      line.appendChild(document.createTextNode(label.slice(0, at)));
      line.appendChild(el('span', 'dz-link', label.slice(at)));
    } else {
      line.appendChild(document.createTextNode(label + ' '));
      line.appendChild(el('span', 'dz-link', linkText));
    }
    zone.appendChild(line);

    var zoneLabel = el('span', 'dz-status');
    zoneLabel.hidden = true;
    zone.appendChild(zoneLabel);
    var progress = el('span', 'dz-bar');
    progress.hidden = true;
    var progressFill = el('span', 'dz-bar-fill');
    progress.appendChild(progressFill);
    zone.appendChild(progress);

    var acceptAttr = accept.slice();
    if (wantsPdf) acceptAttr = ['application/pdf'].concat(acceptAttr);
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = acceptAttr.join(',');
    fileInput.className = 'sr-only';
    fileInput.setAttribute('data-import-file', '1');
    fileInput.tabIndex = -1;
    fileInput.setAttribute('aria-hidden', 'true');

    var resultLine = el('p', 'dz-result muted');
    resultLine.hidden = true;

    function setBusy(text, frac) {
      reading = !!text;
      zone.classList.toggle('busy', reading);
      zone.disabled = reading;
      zoneLabel.textContent = text || '';
      zoneLabel.hidden = !text;
      progress.hidden = !text;
      progressFill.style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + '%';
    }

    function showResult(res) {
      if (!res) return;
      var bits = [plural(res.pages, 'page')];
      if (res.columnsDetected) bits.push(plural(res.columnsDetected, 'column') + ' untangled');
      bits.push(Number(res.chars).toLocaleString() + ' characters');
      resultLine.textContent = 'Read ' + bits.join(' · ');
      resultLine.hidden = false;
    }

    function fail(err) {
      setBusy('', 0);
      if (typeof opts.onError === 'function') {
        try {
          opts.onError(err);
          return;
        } catch (e) {
          /* fall through to the toast */
        }
      }
      toast((err && err.message) || 'Couldn’t read that PDF (it may be scanned images).', { ms: 4200 });
    }

    /** onPages + onText: build the text out of the already-open document. */
    function gatherText(handle) {
      var total = handle.numPages || 0;
      var blocks = [];
      var chain = Promise.resolve();
      var step = function (n) {
        return function () {
          setBusy('Reading page ' + n + ' of ' + total + '…', total ? n / total : 0);
          return handle.textOf(n).then(function (txt) {
            blocks.push('=== PAGE ' + n + ' ===\n' + txt);
          });
        };
      };
      for (var n = 1; n <= total; n++) chain = chain.then(step(n));
      return chain.then(function () {
        setBusy('', 0);
        var text = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
        var res = { text: text, pages: total, chars: text.length, columnsDetected: 0 };
        showResult(res);
        try { opts.onText(res); } catch (e) { fail(e); }
      }, fail);
    }

    function readPdf(file) {
      setBusy('Reading page 1…', 0.02);
      if (typeof opts.onPages === 'function') {
        window.PdfText.open(file).then(function (handle) {
          setBusy('', 0);
          try {
            opts.onPages(handle);
          } catch (e) {
            fail(e);
            return;
          }
          if (typeof opts.onText === 'function') gatherText(handle);
        }, fail);
        return;
      }
      window.PdfText.extract(file, {
        onProgress: function (page, total) {
          setBusy('Reading page ' + page + ' of ' + total + '…', total ? page / total : 0);
        }
      }).then(function (res) {
        setBusy('', 0);
        showResult(res);
        if (typeof opts.onText === 'function') {
          try { opts.onText(res); } catch (e) { fail(e); }
        }
      }, fail);
    }

    function matchesAccept(file) {
      for (var i = 0; i < accept.length; i++) {
        if (fileHasExt(file, accept[i])) return true;
      }
      return false;
    }

    function takeFile(file) {
      if (reading || !file) return;
      var isPdf = wantsPdf && isPdfFile(file);
      if (!isPdf) {
        if (matchesAccept(file) && typeof opts.onFile === 'function') {
          try { opts.onFile(file); } catch (e) { fail(e); }
          return;
        }
        toast(opts.rejectMessage || (accept.length === 1 && wantsPdf ? 'That isn’t a PDF' : 'That file type isn’t supported'));
        return;
      }
      if (!window.PdfText || !window.PdfText.isAvailable()) {
        toast('The PDF reader isn’t available. Paste the text instead.', { ms: 4200 });
        return;
      }
      if (typeof opts.confirm !== 'function') {
        readPdf(file);
        return;
      }
      var gate;
      try {
        gate = opts.confirm(file);
      } catch (e) {
        gate = false;
      }
      Promise.resolve(gate).then(function (ok) {
        if (ok !== false) readPdf(file);
      }, noop);
    }

    on(fileInput, 'change', function () {
      var f = firstFile(fileInput.files);
      fileInput.value = '';
      takeFile(f);
    });

    on(zone, 'click', function () {
      if (!reading) fileInput.click();
    });

    function over(e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('over');
    }
    on(zone, 'dragenter', over);
    on(zone, 'dragover', over);
    on(zone, 'dragleave', function () { zone.classList.remove('over'); });
    on(zone, 'drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('over');
      takeFile(firstFile(e.dataTransfer && e.dataTransfer.files));
    });

    // Anywhere else in the window, a dropped PDF would make the browser
    // navigate away from the app. Swallow it while the zone is alive.
    docGuard = function (e) {
      e.preventDefault();
      if (e.type === 'drop') zone.classList.remove('over');
    };
    document.addEventListener('dragover', docGuard);
    document.addEventListener('drop', docGuard);

    wrap.appendChild(zone);
    wrap.appendChild(fileInput);
    wrap.appendChild(resultLine);

    wrap.zone = zone;
    wrap.fileInput = fileInput;
    wrap.setBusy = setBusy;
    wrap.showResult = showResult;
    wrap.take = takeFile;
    wrap.isReading = function () { return reading; };
    /** Call from the sheet's onClose so the document-level guard goes too. */
    wrap.destroy = function () {
      if (!docGuard) return;
      document.removeEventListener('dragover', docGuard);
      document.removeEventListener('drop', docGuard);
      docGuard = null;
    };
    return wrap;
  }

  /**
   * Paste a whole pattern, see the sections the parser found, then either
   * create/update one part per section or drop the lot into the active part.
   */
  function openImportSheet(projectId, initialText) {
    var p = Store.project(projectId);
    if (!p) return;
    var activeName = (Store.activePart(p) || {}).name || 'this part';
    var area, list, rows = [];
    var dropZone = null;
    var checkField, checkList, checkItems = [];

    function buildRows() {
      var secs = Store.splitSections(area.value);
      var prev = rows;
      rows = secs.map(function (sec, i) {
        var info = sectionRowInfo(sec.text, i);
        var old = prev[i];
        var keep = old && old.parserName === sec.name;
        return {
          parserName: sec.name,
          name: keep ? old.name : sec.name,
          checked: keep ? old.checked : info.rows > 0,
          makeCount: sec.makeCount,
          text: sec.text,
          rows: info.rows,
          computedOnly: info.computedOnly,
          hasTargets: info.hasTargets
        };
      });
    }

    function renderList() {
      clear(list);
      var any = false;
      rows.forEach(function (r) { if (r.rows > 0) any = true; });
      if (!rows.length || !any) {
        list.appendChild(el('p', 'muted', IMPORT_EMPTY));
        return;
      }
      rows.forEach(function (r, i) {
        var item = el('div', 'imp-item');
        var chk = button('check', '✓', 'Import ' + (r.name || 'section ' + (i + 1)));
        chk.setAttribute('role', 'checkbox');
        chk.setAttribute('aria-checked', r.checked ? 'true' : 'false');
        on(chk, 'click', function () {
          r.checked = !r.checked;
          chk.setAttribute('aria-checked', r.checked ? 'true' : 'false');
        });

        var main = el('div', 'imp-main');
        var nameIn = textInput(r.name, 'Part ' + (i + 1));
        nameIn.className = 'imp-name';
        on(nameIn, 'input', function () {
          r.name = nameIn.value;
        });
        main.appendChild(nameIn);

        var meta = [];
        if (r.makeCount > 1) meta.push('×' + r.makeCount);
        meta.push(r.rows ? r.rows + ' ' + rowWord(p).toLowerCase() + (r.rows === 1 ? '' : 's') : 'no rows');
        if (r.rows && r.computedOnly) meta.push('counts computed ≈');
        else if (r.rows && r.hasTargets) meta.push('counts found');
        main.appendChild(el('div', 'imp-meta', meta.join(' · ')));

        item.appendChild(chk);
        item.appendChild(main);
        list.appendChild(item);
      });
    }

    /* ---------------- checklist suggestions ---------------- */

    function buildChecks() {
      var found = [];
      try {
        found = Store.suggestChecklist(area.value) || [];
      } catch (e) {
        found = [];
      }
      var was = {};
      checkItems.forEach(function (c) { was[c.text.toLowerCase()] = c.checked; });
      checkItems = found.map(function (t) {
        var key = t.toLowerCase();
        return { text: t, checked: was[key] === undefined ? true : was[key] };
      });
    }

    function renderChecks() {
      if (!checkField) return;
      checkField.hidden = checkItems.length === 0;
      clear(checkList);
      checkItems.forEach(function (c) {
        var item = el('div', 'imp-item');
        var chk = button('check', '✓', 'Add “' + c.text + '” to the checklist');
        chk.setAttribute('role', 'checkbox');
        chk.setAttribute('aria-checked', c.checked ? 'true' : 'false');
        on(chk, 'click', function () {
          c.checked = !c.checked;
          chk.setAttribute('aria-checked', c.checked ? 'true' : 'false');
        });
        item.appendChild(chk);
        item.appendChild(el('div', 'imp-check-text', c.text));
        checkList.appendChild(item);
      });
    }

    /** @returns {number} how many items were actually added */
    function appendChecklist() {
      var picked = checkItems.filter(function (c) { return c.checked; });
      if (!picked.length) return 0;
      var proj = Store.project(p.id);
      var seen = {};
      (proj && proj.checklist ? proj.checklist : []).forEach(function (c) {
        seen[String(c.text || '').trim().toLowerCase()] = true;
      });
      var added = 0;
      picked.forEach(function (c) {
        var key = c.text.trim().toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = true;
        if (Store.addChecklistItem(p.id, c.text)) added++;
      });
      return added;
    }

    function refresh() {
      buildRows();
      renderList();
      buildChecks();
      renderChecks();
    }

    function checkedSections() {
      var out = [];
      rows.forEach(function (r) {
        if (r.checked) out.push({ name: (r.name || '').trim(), makeCount: r.makeCount, text: r.text });
      });
      return out;
    }

    /* ---------------- PDF drop zone (the shared builder) ---------------- */

    function buildZone(body) {
      dropZone = pdfDropZone({
        tour: 'import-drop',
        ariaLabel: 'Choose a pattern PDF',
        label: 'Drop a pattern PDF here, or choose a file',
        // Reading a second PDF over a box that already has text is a surprise.
        confirm: function (file) {
          if (!area.value.trim()) return true;
          return confirmSheet({
            title: 'Replace the pattern text?',
            message: 'Reading “' + (file.name || 'that PDF') + '” will replace what is in the box.',
            confirmText: 'Replace'
          });
        },
        onText: function (res) {
          area.value = res.text;
          refresh();
          announce('Read ' + plural(res.pages, 'page') + ' from the PDF.');
        }
      });
      body.appendChild(dropZone);
    }

    openSheet({
      title: 'Import pattern',
      cls: 'sheet-import',
      build: function (body) {
        buildZone(body);

        area = textArea(initialText || '', 'mono', 'Paste the instructions from your PDF');
        area.setAttribute('aria-label', 'Pattern text to import');
        area.setAttribute('data-tour', 'import-text');
        body.appendChild(field('Pattern text', area, 'Drop the PDF above, or paste the instructions straight in.'));
        list = el('div', 'imp-list');
        list.setAttribute('data-tour', 'import-list');
        body.appendChild(field('Sections detected', list));

        checkList = el('div', 'imp-list');
        checkList.setAttribute('data-tour', 'import-checklist');
        checkField = field('Checklist items found', checkList, 'Ticked items get added to the assembly checklist.');
        checkField.hidden = true;
        body.appendChild(checkField);

        on(area, 'input', debounce(refresh, 200));
        refresh();
      },
      onClose: function () {
        if (dropZone) dropZone.destroy();
      },
      footer: [
        {
          text: 'Put it all in ' + (activeName.length > 16 ? activeName.slice(0, 15) + '…' : activeName),
          cls: 'btn ghost wrap-label',
          tour: 'import-all',
          onClick: function (api) {
            if (!area.value.trim()) {
              toast('Nothing to import yet');
              return;
            }
            Store.importPatternSections(
              p.id,
              [{ name: activeName, makeCount: 1, text: area.value }],
              { mode: 'active', text: area.value }
            );
            var extra = appendChecklist();
            api.close();
            render();
            toast('Pattern saved into ' + activeName + checklistSuffix(extra), { ms: extra ? 3200 : 2600 });
          }
        },
        {
          text: 'Create parts',
          cls: 'btn primary',
          tour: 'import-create',
          onClick: function (api) {
            var secs = checkedSections();
            if (!secs.length) {
              toast('Tick at least one section first');
              return;
            }
            var res = Store.importPatternSections(p.id, secs, { mode: 'parts', text: area.value });
            var extra = appendChecklist();
            api.close();
            render();
            var msg;
            if (res.created && res.updated) {
              msg = 'Created ' + plural(res.created, 'part') + ' · updated ' + res.updated;
            } else if (res.created) {
              msg = 'Created ' + plural(res.created, 'part');
            } else if (res.updated) {
              msg = 'Updated ' + plural(res.updated, 'part');
            } else {
              msg = 'Nothing imported';
            }
            toast(msg + checklistSuffix(extra), { ms: 3600 });
          }
        }
      ]
    });
  }

  function checklistSuffix(n) {
    return n ? ' · + ' + plural(n, 'checklist item') : '';
  }

  /* ================================================================== *
   * 17. Pattern sheet
   * ================================================================== */

  function openPatternSheet(projectId, partId) {
    var p = Store.project(projectId);
    var prt = Store.part(p, partId);
    if (!p || !prt) return;
    var lines = Store.linesFor(prt);
    var ri = Store.repeatInfo(prt);
    // Only the section the counter is actually working in gets highlighted.
    var currentLine = Store.lineForRow(prt, ri.patternRow);
    var currentSection = currentLine && typeof currentLine.section === 'number' ? currentLine.section : null;

    openSheet({
      title: 'Pattern · ' + prt.name,
      build: function (body, api) {
        if (!lines.length) {
          body.appendChild(el('p', 'muted', 'No pattern yet. Add one in the part editor.'));
          var edit = button('btn primary block', 'Open part editor');
          on(edit, 'click', function () {
            api.close();
            openPartEditor(p.id, prt.id);
          });
          body.appendChild(edit);
          return;
        }

        var wrap = el('div', 'pattern-lines');
        var currentNode = null;
        lines.forEach(function (line) {
          var hasRow = typeof line.row === 'number' && line.row > 0;
          var isSetup = line.kind === 'setup' || (line.row === 0 && line.kind !== 'header' && line.kind !== 'note');
          var notes = Store.notesOf(line);

          // Section headers are not tappable.
          if (line.kind === 'header') {
            wrap.appendChild(el('div', 'pline-header', line.text));
            return;
          }

          // Setup / foundation lines: labelled, not tappable (there is no row 0).
          if (!hasRow && isSetup) {
            var setupNode = el('div', 'pline pline-setup');
            setupNode.appendChild(el('span', 'pline-tag', 'Setup'));
            setupNode.appendChild(el('span', 'pline-body', line.text));
            wrap.appendChild(setupNode);
            appendNotes(wrap, notes);
            return;
          }

          var isCurrent =
            hasRow &&
            lineCoversRow(line, ri.patternRow) &&
            (currentSection === null || typeof line.section !== 'number' || line.section === currentSection);
          var cls = 'pline' + (hasRow ? ' has-row' : ' plain') + (isCurrent ? ' on' : '');
          var node = button(cls, line.text);
          if (hasRow && Store.isComputed(line)) {
            var c = Store.countOf(line);
            if (c !== null) {
              node.appendChild(document.createTextNode(' '));
              node.appendChild(el('span', 'pline-count', '≈' + c));
            }
          }
          if (isCurrent && !currentNode) {
            currentNode = node;
            node.setAttribute('aria-current', 'true');
          }
          if (hasRow) {
            on(node, 'click', function () {
              confirmSheet({
                title: 'Jump to ' + rowWord(p).toLowerCase() + ' ' + line.row + '?',
                message: 'The counter will move to ' + rowWord(p).toLowerCase() + ' ' + line.row +
                  ' and stitches reset to 0.',
                confirmText: 'Jump'
              }).then(function (ok) {
                if (!ok) return;
                Store.jumpToRow(p.id, prt.id, line.row);
                api.close();
                render();
                announce(rowWord(p) + ' ' + Math.max(0, line.row - 1));
              });
            });
          } else {
            node.disabled = true;
          }
          wrap.appendChild(node);
          appendNotes(wrap, notes);
        });
        body.appendChild(wrap);

        if (currentNode) {
          window.setTimeout(function () {
            try {
              currentNode.scrollIntoView({ block: 'center' });
            } catch (e) {
              currentNode.scrollIntoView();
            }
          }, 40);
        }
      }
    });
  }

  /** Notes attached to a pattern line, rendered underneath it. */
  function appendNotes(wrap, notes) {
    if (!notes || !notes.length) return;
    notes.forEach(function (n) {
      wrap.appendChild(el('div', 'pline-note', n));
    });
  }

  function lineCoversRow(line, row) {
    if (typeof line.row !== 'number') return false;
    var end = typeof line.rowEnd === 'number' && line.rowEnd >= line.row ? line.rowEnd : line.row;
    return row >= line.row && row <= end;
  }

  /* ================================================================== *
   * 18. Checklist / notes / history / status sheets
   * ================================================================== */

  function openChecklistSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;

    openSheet({
      title: 'Assembly checklist',
      build: function (body) {
        var count = el('p', 'muted');
        var list = el('div', 'list');
        list.setAttribute('data-tour', 'checklist-list');
        var addRow = el('div', 'row-flex');
        var input = textInput('', 'Sew the tail on');
        var addBtn = button('btn primary', 'Add');
        addBtn.style.flex = '0 0 auto';
        var actions = el('div', 'danger-zone');
        var editingId = null;

        /** The template this project came from, when it still exists. */
        function sourceTemplate() {
          if (!p.templateId) return null;
          return Store.template(p.templateId) || null;
        }

        function renderItem(item, idx) {
          var row = el('div', 'list-item' + (item.done ? ' done' : ''));

          var chk = button('check', '✓', item.text);
          chk.setAttribute('role', 'checkbox');
          chk.setAttribute('aria-checked', item.done ? 'true' : 'false');
          on(chk, 'click', function () {
            Store.toggleChecklistItem(p.id, item.id);
            fb('tap');
            refresh();
          });
          row.appendChild(chk);

          if (editingId === item.id) {
            var inp = textInput(item.text, 'Sew the tail on');
            inp.className = 'item-edit';
            inp.setAttribute('aria-label', 'Rename ' + item.text);
            var settled = false;
            function commit() {
              if (settled) return;
              settled = true;
              editingId = null;
              var v = inp.value.trim();
              if (v && v !== item.text) Store.renameChecklistItem(p.id, item.id, v);
              refresh();
            }
            function cancelEdit() {
              if (settled) return;
              settled = true;
              editingId = null;
              refresh();
            }
            on(inp, 'keydown', function (e) {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape' || e.key === 'Esc') {
                // Don't let Escape reach the <dialog> and close the sheet.
                e.preventDefault();
                e.stopPropagation();
                cancelEdit();
              }
            });
            on(inp, 'blur', commit);
            row.appendChild(inp);
            window.setTimeout(function () {
              inp.focus();
              inp.select();
            }, 0);
          } else {
            var text = button('item-text item-text-btn', item.text, 'Rename ' + item.text);
            on(text, 'click', function () {
              editingId = item.id;
              refresh();
            });
            row.appendChild(text);
          }

          var up = button('item-move', '▲', 'Move ' + item.text + ' up');
          up.disabled = idx === 0;
          on(up, 'click', function () {
            Store.moveChecklistItem(p.id, item.id, -1);
            refresh();
          });
          var down = button('item-move', '▼', 'Move ' + item.text + ' down');
          down.disabled = idx === p.checklist.length - 1;
          on(down, 'click', function () {
            Store.moveChecklistItem(p.id, item.id, 1);
            refresh();
          });
          var del = button('item-del', '✕', 'Delete ' + item.text);
          on(del, 'click', function () {
            Store.deleteChecklistItem(p.id, item.id);
            refresh();
          });
          row.appendChild(up);
          row.appendChild(down);
          row.appendChild(del);
          return row;
        }

        function renderActions() {
          clear(actions);
          var doneCount = 0;
          p.checklist.forEach(function (i) { if (i.done) doneCount++; });

          var tpl = sourceTemplate();
          if (tpl) {
            var reload = button('btn block', '↻ Reload from “' + tpl.name + '”');
            reload.setAttribute('data-tour', 'checklist-reload');
            on(reload, 'click', function () {
              confirmSheet({
                title: 'Reload the checklist?',
                message: 'The list is replaced by the ' + tpl.checklist.length + ' step' +
                  (tpl.checklist.length === 1 ? '' : 's') + ' from “' + tpl.name +
                  '”. Anything you added or ticked here is lost.',
                confirmText: 'Reload'
              }).then(function (ok) {
                if (!ok) return;
                var n = Store.reloadChecklistFromTemplate(p.id);
                refresh();
                toast(n === null ? 'That template is gone' : 'Loaded ' + n + ' step' + (n === 1 ? '' : 's'));
              });
            });
            actions.appendChild(reload);
          }

          if (doneCount) {
            var clearDone = button('btn block', 'Clear completed (' + doneCount + ')');
            on(clearDone, 'click', function () {
              confirmSheet({
                title: 'Clear completed?',
                message: doneCount + ' ticked item' + (doneCount === 1 ? '' : 's') + ' will be removed.',
                confirmText: 'Clear'
              }).then(function (ok) {
                if (!ok) return;
                var n = Store.clearChecklist(p.id, { completedOnly: true });
                refresh();
                toast('Cleared ' + n + ' item' + (n === 1 ? '' : 's'));
              });
            });
            actions.appendChild(clearDone);
          }

          if (p.checklist.length) {
            var clearAll = button('btn danger block', 'Clear all');
            on(clearAll, 'click', function () {
              confirmSheet({
                title: 'Clear the whole checklist?',
                message: 'All ' + p.checklist.length + ' item' + (p.checklist.length === 1 ? '' : 's') +
                  ' will be removed.',
                confirmText: 'Clear all',
                danger: true
              }).then(function (ok) {
                if (!ok) return;
                Store.clearChecklist(p.id, { completedOnly: false });
                refresh();
                toast('Checklist cleared');
              });
            });
            actions.appendChild(clearAll);
          }
        }

        function refresh() {
          var done = 0;
          p.checklist.forEach(function (i) { if (i.done) done++; });
          count.textContent = done + ' of ' + p.checklist.length + ' done';
          clear(list);
          if (!p.checklist.length) {
            list.appendChild(el('p', 'muted', 'Nothing on the list yet.'));
          } else {
            p.checklist.forEach(function (item, idx) {
              list.appendChild(renderItem(item, idx));
            });
          }
          renderActions();
        }

        function add() {
          if (!input.value.trim()) return;
          Store.addChecklistItem(p.id, input.value);
          input.value = '';
          refresh();
          input.focus();
        }
        on(addBtn, 'click', add);
        on(input, 'keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        });

        addRow.appendChild(input);
        addRow.appendChild(addBtn);

        body.appendChild(count);
        body.appendChild(list);
        body.appendChild(addRow);
        body.appendChild(el('div', 'field-hint', 'Tap an item’s text to rename it.'));
        body.appendChild(actions);
        refresh();
      },
      onClose: function () {
        render();
      }
    });
  }

  function openNotesSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    openSheet({
      title: 'Project notes',
      build: function (body) {
        var area = textArea(p.notes, '', 'Hook, yarn, pattern link, mods…');
        area.style.minHeight = '220px';
        var save = debounce(function () {
          Store.setNotes(p.id, area.value);
        }, 300);
        on(area, 'input', save);
        body.appendChild(field('Notes', area, 'Saves as you type.'));
      },
      onClose: function () {
        Store.flush();
      }
    });
  }

  function openPlacementSheet(projectId, partId) {
    var p = Store.project(projectId);
    var prt = Store.part(p, partId);
    if (!p || !prt) return;
    openSheet({
      title: 'Placement notes · ' + prt.name,
      build: function (body) {
        var area = textArea(prt.placementNotes, '', 'Eyes between rnd 8–9, 6 sts apart');
        area.style.minHeight = '180px';
        var save = debounce(function () {
          Store.updatePart(p.id, prt.id, { placementNotes: area.value });
        }, 400);
        on(area, 'input', save);
        body.appendChild(field('Where things go', area, 'Saves as you type.'));
      },
      onClose: function () {
        Store.flush();
        render();
      }
    });
  }

  function openAlertsSheet(projectId, partId) {
    var p = Store.project(projectId);
    var prt = Store.part(p, partId);
    if (!p || !prt) return;
    var input;
    openSheet({
      title: 'Stitch alerts · ' + prt.name,
      build: function (body) {
        input = textInput(prt.alerts.join(', '), '40, 80');
        body.appendChild(
          field('Buzz at stitch', input, 'Comma-separated stitch numbers within a row. Great for marking increases.')
        );
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save',
          cls: 'btn primary',
          onClick: function (api) {
            Store.updatePart(p.id, prt.id, { alerts: parseNumberList(input.value) });
            api.close();
            render();
          }
        }
      ]
    });
  }

  function openHistorySheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    openSheet({
      title: 'History',
      build: function (body, api) {
        if (!p.history.length) {
          body.appendChild(el('p', 'muted', 'No completed rows yet.'));
          return;
        }
        var list = el('div', 'list');
        for (var i = p.history.length - 1; i >= 0; i--) {
          var h = p.history[i];
          var row = el('div', 'hist-item');
          row.appendChild(el('span', null, h.partName + ' · ' + shortRowWord(p) + ' ' + h.row));
          row.appendChild(el('span', 'hist-when', fmtClock(h.ts)));
          list.appendChild(row);
        }
        body.appendChild(list);

        var clearBtn = button('btn danger block', 'Clear history');
        on(clearBtn, 'click', function () {
          confirmSheet({
            title: 'Clear history?',
            message: 'The row log is erased. Counters are not affected.',
            confirmText: 'Clear',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            Store.clearHistory(p.id);
            api.close();
          });
        });
        body.appendChild(clearBtn);
      }
    });
  }

  function openStatusSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    openSheet({
      title: 'Project status',
      build: function (body, api) {
        var list = el('div', 'list');
        STATUS_INFO.forEach(function (s) {
          var b = button('status-opt' + (p.status === s.id ? ' on' : ''));
          b.appendChild(el('b', null, s.label));
          b.appendChild(el('span', null, s.desc));
          on(b, 'click', function () {
            Store.setStatus(p.id, s.id);
            if (s.id === 'finished') celebrate('project');
            api.close();
            render();
            toast('Status: ' + s.label);
          });
          list.appendChild(b);
        });
        body.appendChild(list);
      }
    });
  }

  /** The ⋯ menu for a craft project: v1 hides the crochet-only entries. */
  function craftMenuItems(p) {
    var def = craftFor(p);
    var items = [];

    if (def && typeof def.openImportSheet === 'function') {
      items.push({
        icon: '📋',
        label: 'Import pattern',
        run: function () {
          try { def.openImportSheet(p.id); } catch (e) { toast('That sheet could not open'); }
        }
      });
    }
    items.push({ icon: '✅', label: 'Checklist', run: function () { openChecklistSheet(p.id); } });

    // The craft's own entries sit above Notes.
    if (def && typeof def.menuItems === 'function') {
      var extra = [];
      try { extra = def.menuItems(p) || []; } catch (e) { extra = []; }
      if (Array.isArray(extra)) {
        extra.forEach(function (it) {
          if (!it || typeof it.run !== 'function' || !it.label) return;
          items.push({ icon: it.icon || '•', label: it.label, run: it.run });
        });
      }
    }

    items.push({ icon: '📝', label: 'Notes', run: function () { openNotesSheet(p.id); } });
    items.push({ icon: '🕘', label: 'History', run: function () { openHistorySheet(p.id); } });
    items.push({ icon: '🏷️', label: 'Status', run: function () { openStatusSheet(p.id); } });
    items.push({ icon: '📤', label: 'Export backup', run: function () { exportBackup(); } });
    items.push({ icon: '❓', label: 'Show me around', run: function () { startTour('counter'); } });
    return items;
  }

  function openMenuSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var items = isCraftProject(p) ? craftMenuItems(p) : [
      { icon: '🧩', label: 'Parts', run: function () { openPartsSheet(p.id); } },
      { icon: '📋', label: 'Import pattern', run: function () { openImportSheet(p.id, ''); } },
      { icon: '✅', label: 'Checklist', run: function () { openChecklistSheet(p.id); } },
      { icon: '📝', label: 'Notes', run: function () { openNotesSheet(p.id); } },
      { icon: '🎨', label: 'Yarn colours', run: function () { openYarnSheet(p.id); } },
      { icon: '🕘', label: 'History', run: function () { openHistorySheet(p.id); } },
      { icon: '🏷️', label: 'Status', run: function () { openStatusSheet(p.id); } },
      {
        icon: '🧵',
        label: 'Save as template',
        run: function () {
          var draft = Store.templateFromProject(p.id);
          if (!draft) return;
          openTemplateEditor({ draft: draft });
        }
      },
      { icon: '📤', label: 'Export backup', run: function () { exportBackup(); } },
      { icon: '❓', label: 'Show me around', run: function () { startTour('counter'); } }
    ];
    openSheet({
      title: p.name,
      build: function (body, api) {
        var list = el('div', 'list');
        items.forEach(function (it) {
          var b = button('menu-item');
          b.appendChild(el('span', 'menu-icon', it.icon));
          b.appendChild(el('span', null, it.label));
          on(b, 'click', function () {
            api.close();
            it.run();
          });
          list.appendChild(b);
        });
        body.appendChild(list);
      }
    });
  }

  /* ================================================================== *
   * 19. Export / import
   * ================================================================== */

  function backupFilename() {
    var d = new Date();
    return 'thready-or-not-backup-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.json';
  }

  function backupBlob() {
    Store.flush();
    return new Blob([Store.exportJSON()], { type: 'application/json' });
  }

  function exportBackup() {
    try {
      var name = backupFilename();
      var url = URL.createObjectURL(backupBlob());
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1500);
      toast('Backup downloaded');
    } catch (e) {
      toast('Could not create the backup file');
    }
  }

  function canShareBackup() {
    if (!navigator.share || !navigator.canShare || typeof window.File !== 'function') return false;
    try {
      var probe = new File([new Blob(['{}'], { type: 'application/json' })], 'probe.json', {
        type: 'application/json'
      });
      return navigator.canShare({ files: [probe] });
    } catch (e) {
      return false;
    }
  }

  function shareBackup() {
    try {
      var file = new File([backupBlob()], backupFilename(), { type: 'application/json' });
      navigator.share({ files: [file], title: 'Thready or Not backup' }).catch(noop);
    } catch (e) {
      exportBackup();
    }
  }

  function importBackup() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    on(input, 'change', function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = Store.importJSON(String(reader.result));
          applyTheme(Store.settings().theme, false);
          render();
          toast('Imported ' + n + ' project' + (n === 1 ? '' : 's'));
        } catch (err) {
          toast(err && err.message ? err.message : 'Import failed');
        }
      };
      reader.onerror = function () {
        toast('Could not read that file');
      };
      reader.readAsText(file);
    });
    input.click();
  }

  /* ================================================================== *
   * 20. Settings sheet
   * ================================================================== */

  function themeCard(t, currentId, onPick) {
    var card = button('theme-card' + (t.id === currentId ? ' on' : ''));
    card.setAttribute('aria-pressed', t.id === currentId ? 'true' : 'false');
    var sw = el('div', 'swatches');
    (Array.isArray(t.swatches) ? t.swatches : []).slice(0, 4).forEach(function (c) {
      var s = el('span', 'swatch');
      s.style.background = c;
      sw.appendChild(s);
    });
    card.appendChild(sw);
    card.appendChild(el('div', 'theme-name', (t.emoji ? t.emoji + ' ' : '') + (t.name || t.id)));
    if (t.tagline) card.appendChild(el('div', 'theme-tagline', t.tagline));
    on(card, 'click', function () {
      onPick(t.id);
    });
    return card;
  }

  /* ================================================================== *
   * 20b. Guided help (tours + FAQ)
   * ================================================================== */

  var FAQ = [
    {
      q: 'How do I get a pattern into the app?',
      a: 'Open a project, tap ⋯ and choose Import pattern. Paste the instructions straight out of your ' +
        'PDF — headings like BODY or “Wings (make 2)” turn into parts, and Create parts sets them all up. ' +
        'If the pattern is one piece, use “Put it all in …” instead and it goes into the part you are on.'
    },
    {
      q: 'What does the ≈ in front of a stitch count mean?',
      a: 'It means nobody wrote that number down. Your pattern line had no count in brackets, so we worked ' +
        'it out from the instruction itself (6 sc in a magic ring, then inc ×6, and so on). A plain number ' +
        'with no ≈ was read straight off the page and is the one to trust.'
    },
    {
      q: 'How do repeats work?',
      a: 'Open the part editor (tap the tab you are already on), turn on Enable repeat and set From, To and ' +
        'Times. The counter then shows “Repeat 2 of 6 · round 3 of 4”, and the pattern line follows the ' +
        'repeated rows instead of running off the end of your pattern.'
    },
    {
      q: 'Can it buzz at a particular stitch?',
      a: 'Yes — the 🔔 Alerts button at the bottom of a project. Type the stitch numbers you care about ' +
        '(say 40, 80) and it flashes and buzzes there on every row. Good for increases you keep missing.'
    },
    {
      q: 'What does group size 0 do?',
      a: 'It turns grouping off completely. Normally the readout counts you through groups of ten — ' +
        '“Group 2 of 3 · stitch 4 of 10” — with a little buzz at each boundary. Set the group size to 0 in ' +
        'the project editor and you just get the plain stitch number, no groups and no boundary buzz.'
    },
    {
      q: 'Where are my projects saved, and how do I back them up?',
      a: 'Everything lives on this device, in this browser — nothing is uploaded anywhere. Use Download ' +
        'backup above for a JSON file you can keep or move to another phone, and Import backup to read one ' +
        'back in. Imports merge by project id, so the imported copy wins.'
    }
  ];

  function tourAvailable() {
    return !!(window.Tour && typeof window.Tour.start === 'function');
  }

  /** Start a tour by id, closing any sheets that are in the way first. */
  function startTour(id, opts) {
    if (!tourAvailable()) {
      toast('Tours are unavailable right now');
      return Promise.resolve(null);
    }
    return window.Tour.start(id, opts || {});
  }

  /** First run: home → counter (sample project) → offer the import tour. */
  function startWelcomeTour() {
    Store.setSetting('welcomed', true);
    renderHome();
    if (!tourAvailable()) return;
    var ctx = {};
    window.Tour.start('home', { ctx: ctx })
      .then(function (res) {
        // Skipping the home tour ends the chain — no silent jump onwards.
        if (!res || res.reason !== 'done') return false;
        return window.Tour.prompt({
          title: 'Next: counting a project',
          body: 'We’ll make a sample sheep project so you can try the counter. ' +
            'You can delete it at the end.',
          confirmText: 'Show me',
          cancelText: 'Not now'
        });
      })
      .then(function (go) {
        if (!go) {
          window.Tour.markSeen('home');
          return false;
        }
        return window.Tour.start('counter', { ctx: ctx, sampleOffer: false }).then(function () {
          return true;
        });
      })
      .then(function (went) {
        if (!went || !Store.projects().length) return null;
        return window.Tour.prompt({
          title: 'One more: importing a pattern',
          body: 'Most patterns arrive as a PDF. Paste one in and we’ll pick out the parts — ' +
            'it takes about thirty seconds.',
          confirmText: 'Show me',
          cancelText: 'Not now'
        }).then(function (ok) {
          return ok ? window.Tour.start('import', { ctx: ctx }) : null;
        });
      })
      .then(function () {
        // The sample project's send-off, saved until the very end of the chain.
        if (!ctx.sampleId || !Store.project(ctx.sampleId)) return;
        return confirmSheet({
          title: 'Keep “' + Store.project(ctx.sampleId).name + '”?',
          message: 'We made that project just for the tour. Keep it to practise on, or bin it and start clean.',
          cancelText: 'Delete it',
          confirmText: 'Keep it'
        }).then(function (keep) {
          if (keep) return;
          Store.setActiveProject(null);
          Store.deleteProject(ctx.sampleId);
          Store.clearUndo();
          render();
          toast('Sample project removed');
        });
      })
      .catch(noop);
  }

  function helpSection() {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-tour', 'settings-help');
    wrap.appendChild(el('div', 'field-label', 'Help & tours'));

    if (!tourAvailable()) {
      wrap.appendChild(el('p', 'muted', 'Guided tours are unavailable right now.'));
    } else {
      var listWrap = el('div', 'help-list');
      window.Tour.list().forEach(function (t) {
        var row = el('div', 'help-item');
        var main = el('div', 'help-main');
        main.appendChild(el('div', 'help-name', t.title));
        main.appendChild(el('div', 'help-blurb', t.blurb));
        row.appendChild(main);
        if (t.seen) {
          var tick = el('span', 'help-seen', '✓');
          tick.setAttribute('aria-label', 'Already seen');
          row.appendChild(tick);
        }
        var go = button('btn', t.seen ? 'Replay' : 'Start');
        go.setAttribute('aria-label', (t.seen ? 'Replay' : 'Start') + ' the tour: ' + t.title);
        on(go, 'click', function () {
          closeAllSheets();
          startTour(t.id);
        });
        row.appendChild(go);
        listWrap.appendChild(row);
      });
      wrap.appendChild(listWrap);
      wrap.appendChild(
        el('div', 'field-hint', 'A tour dims the screen and points at things — you can still tap them.')
      );
    }

    var faqWrap = el('div', 'faq-list');
    FAQ.forEach(function (item) {
      var d = document.createElement('details');
      d.className = 'faq';
      var s = document.createElement('summary');
      s.textContent = item.q;
      d.appendChild(s);
      d.appendChild(el('p', null, item.a));
      faqWrap.appendChild(d);
    });
    wrap.appendChild(faqWrap);
    return wrap;
  }

  function openSettingsSheet() {
    openSheet({
      title: 'Settings',
      build: function (body) {
        /* ---- Themes ---- */
        var themes = themeList();
        var themeWrap = el('div', 'field');
        themeWrap.appendChild(el('div', 'field-label', 'Theme'));
        if (!themes.length) {
          themeWrap.appendChild(el('p', 'muted', 'Themes are unavailable right now.'));
        } else {
          var groups = [
            { id: 'stardew', label: 'Stardew' },
            { id: 'dragon', label: 'Dragon' }
          ];
          var seen = {};
          function pick(id) {
            applyTheme(id);
            // refresh selection highlight
            Array.prototype.forEach.call(themeWrap.querySelectorAll('.theme-card'), function (c) {
              var on2 = c.getAttribute('data-theme-id') === id;
              c.classList.toggle('on', on2);
              c.setAttribute('aria-pressed', on2 ? 'true' : 'false');
            });
            fb('tap');
          }
          groups.forEach(function (g) {
            var inGroup = themes.filter(function (t) { return t.group === g.id; });
            if (!inGroup.length) return;
            themeWrap.appendChild(el('div', 'group-title', g.label));
            var grid = el('div', 'theme-grid');
            inGroup.forEach(function (t) {
              seen[t.id] = true;
              var c = themeCard(t, Store.settings().theme, pick);
              c.setAttribute('data-theme-id', t.id);
              grid.appendChild(c);
            });
            themeWrap.appendChild(grid);
          });
          var rest = themes.filter(function (t) { return !seen[t.id]; });
          if (rest.length) {
            themeWrap.appendChild(el('div', 'group-title', 'More'));
            var grid2 = el('div', 'theme-grid');
            rest.forEach(function (t) {
              var c2 = themeCard(t, Store.settings().theme, pick);
              c2.setAttribute('data-theme-id', t.id);
              grid2.appendChild(c2);
            });
            themeWrap.appendChild(grid2);
          }
        }
        body.appendChild(themeWrap);

        /* ---- Toggles ---- */
        var s = Store.settings();
        var toggles = el('div', 'field');
        toggles.appendChild(el('div', 'field-label', 'Feedback'));
        toggles.appendChild(
          switchRow('Haptics', 'Vibrate on taps and milestones.', s.haptics, function (v) {
            Store.setSetting('haptics', v);
            if (v) fb('tap');
          })
        );
        toggles.appendChild(
          switchRow('Sounds', 'Little synthesized clicks and chimes.', s.sounds, function (v) {
            Store.setSetting('sounds', v);
            if (v) fb('tap');
          })
        );
        toggles.appendChild(
          switchRow('Auto-advance rows', 'Complete the row when the pattern stitch count is reached.', s.autoAdvance, function (v) {
            Store.setSetting('autoAdvance', v);
          })
        );
        if (diagramAvailable()) {
          toggles.appendChild(
            switchRow('Live diagram', 'Your piece, in 3D, inside the stitch button.', s.liveDiagram !== false, function (v) {
              Store.setSetting('liveDiagram', v);
              if (v) mountLiveDiagram();
              else destroyLiveDiagram();
            })
          );
        }
        if (wakeSupported) {
          toggles.appendChild(
            switchRow('Keep screen awake', 'While a project is open.', s.keepAwake, function (v) {
              Store.setSetting('keepAwake', v);
              syncWakeLock();
              render();
            })
          );
        }
        body.appendChild(toggles);

        /* ---- Templates ---- */
        var tplField = el('div', 'field');
        tplField.setAttribute('data-tour', 'settings-templates');
        tplField.appendChild(el('div', 'field-label', 'Templates'));
        var tplList = el('div', 'list');
        renderTemplateList(tplList);
        tplField.appendChild(tplList);
        var newTpl = button('btn block', '＋ New template');
        newTpl.setAttribute('data-tour', 'settings-new-template');
        on(newTpl, 'click', function () {
          openTemplateEditor({
            onSaved: function () {
              renderTemplateList(tplList);
            }
          });
        });
        tplField.appendChild(newTpl);
        tplField.appendChild(el('div', 'field-hint', 'Templates set up the parts and checklist of a new project.'));
        body.appendChild(tplField);

        /* ---- Backup ---- */
        var backup = el('div', 'field');
        backup.appendChild(el('div', 'field-label', 'Backup'));
        var exp = button('btn block', '📥 Download backup');
        on(exp, 'click', exportBackup);
        backup.appendChild(exp);
        if (canShareBackup()) {
          var shareBtn = button('btn block', '📤 Share backup');
          on(shareBtn, 'click', shareBackup);
          backup.appendChild(shareBtn);
        }
        var imp = button('btn block', '📂 Import backup');
        on(imp, 'click', importBackup);
        backup.appendChild(imp);
        backup.appendChild(el('div', 'field-hint', 'Backups merge by project id — imported projects win.'));
        body.appendChild(backup);

        /* ---- Help & tours ---- */
        body.appendChild(helpSection());

        /* ---- Crafts ---- */
        if (multiCraft()) {
          var craftField = el('div', 'field');
          craftField.appendChild(el('div', 'field-label', 'Crafts'));
          var craftRows = el('div', 'help-list');
          craftList().forEach(function (c) {
            var row = el('div', 'help-item');
            var cmain = el('div', 'help-main');
            cmain.appendChild(el('div', 'help-name', c.emoji + ' ' + c.name));
            if (c.tagline) cmain.appendChild(el('div', 'help-blurb', c.tagline));
            row.appendChild(cmain);
            craftRows.appendChild(row);
          });
          craftField.appendChild(craftRows);
          craftField.appendChild(
            el('div', 'field-hint', 'Pick the craft when you start a project — it cannot be changed later.')
          );
          body.appendChild(craftField);
        }

        /* ---- About ---- */
        var about = el('div', 'field');
        about.appendChild(el('div', 'field-label', 'About'));
        about.appendChild(el('p', 'muted', 'Thready or Not v' + APP_VERSION + ' · everything stays on this device.'));
        body.appendChild(about);
      }
    });
  }

  /* ================================================================== *
   * 21. Static event wiring
   * ================================================================== */

  function bindEvents() {
    // Home
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="new-project"]'), function (b) {
      on(b, 'click', function () {
        openProjectEditor(null);
      });
    });
    on($('#btn-settings'), 'click', openSettingsSheet);

    // First-run welcome card
    on($('#welcome-start'), 'click', startWelcomeTour);
    on($('#welcome-dismiss'), 'click', function () {
      Store.setSetting('welcomed', true);
      renderHome();
      toast('No problem — the tours live in Settings.');
    });

    on(els.finishedToggle, 'click', function () {
      finishedOpen = !finishedOpen;
      renderHome();
    });

    // Project header
    on($('#p-back'), 'click', goHome);
    on($('#p-title'), 'click', function () {
      var p = currentProject();
      if (p) openProjectEditor(p.id);
    });
    on(els.pTimer, 'click', function () {
      var p = currentProject();
      if (!p) return;
      Store.toggleTimer(p.id);
      updateTimerChip(p);
      fb('tap');
    });
    on($('#p-menu'), 'click', function () {
      var p = currentProject();
      if (p) openMenuSheet(p.id);
    });

    // Craft header (#screen-craft) — the same four controls.
    on($('#c-back'), 'click', goHome);
    on($('#c-title'), 'click', function () {
      var p = currentProject();
      if (p) openProjectEditor(p.id);
    });
    on(els.cTimer, 'click', function () {
      var p = currentProject();
      if (!p) return;
      Store.toggleTimer(p.id);
      updateCraftTimerChip(p);
      fb('tap');
    });
    on($('#c-menu'), 'click', function () {
      var p = currentProject();
      if (p) openMenuSheet(p.id);
    });

    // Row controls
    on($('#row-plus'), 'click', function () {
      var p = currentProject();
      var prt = currentPart();
      if (!p || !prt) return;
      applyResult(Store.tapRow(p.id, prt.id));
    });
    on($('#row-minus'), 'click', function () {
      var p = currentProject();
      var prt = currentPart();
      if (!p || !prt) return;
      Store.untapRow(p.id, prt.id);
      fb('undo');
      render();
      announce(rowWord(p) + ' ' + Store.activePart(p).row);
    });

    // Pattern line
    on(els.patternLine, 'click', function () {
      var p = currentProject();
      var prt = currentPart();
      if (p && prt) openPatternSheet(p.id, prt.id);
    });

    // Stitch controls
    bindStitchButton();
    on($('#stitch-minus'), 'click', function () {
      var p = currentProject();
      var prt = currentPart();
      if (!p || !prt) return;
      Store.untapStitch(p.id, prt.id);
      fb('undo');
      updateCounters(p, Store.activePart(p));
      updateBottomBar(p, Store.activePart(p));
      pushDiagram('none');
    });
    on($('#stitch-reset'), 'click', function () {
      var p = currentProject();
      var prt = currentPart();
      if (!p || !prt) return;
      Store.resetStitches(p.id, prt.id);
      fb('undo');
      render();
      toast('Stitches reset');
    });

    // Bottom bar
    on(els.btnUndo, 'click', function () {
      if (Store.undo()) {
        fb('undo');
        render();
        toast('Undone');
      }
    });
    on(els.btnWake, 'click', function () {
      var next = !Store.settings().keepAwake;
      Store.setSetting('keepAwake', next);
      syncWakeLock();
      var p = currentProject();
      if (p) updateBottomBar(p, Store.activePart(p));
      toast(next ? 'Screen will stay awake' : 'Screen can sleep again');
    });
    on(els.btnAlerts, 'click', function () {
      var p = currentProject();
      var prt = currentPart();
      if (p && prt) openAlertsSheet(p.id, prt.id);
    });
    on(els.btnPlace, 'click', function () {
      var p = currentProject();
      var prt = currentPart();
      if (p && prt) openPlacementSheet(p.id, prt.id);
    });

    // Persistence + wake lock lifecycle
    on(document, 'visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        Store.flush();
      } else {
        syncWakeLock();
        render();
      }
    });
    window.addEventListener('resize', debounce(resizeDiagrams, 120));
    window.addEventListener('pagehide', function () {
      Store.flush();
    });
    window.addEventListener('beforeunload', function () {
      Store.flush();
    });
  }

  /* ================================================================== *
   * 22. Timer ticking
   * ================================================================== */

  function tick() {
    var p = currentProject();
    if (p && els.craft && !els.craft.hidden) {
      if (p.timer && p.timer.runningSince) updateCraftTimerChip(p);
      return;
    }
    if (p && !els.project.hidden) {
      if (p.timer && p.timer.runningSince) updateTimerChip(p);
      return;
    }
    // Home: keep running project cards ticking without a full re-render.
    var nodes = document.querySelectorAll('[data-timer-project]');
    for (var i = 0; i < nodes.length; i++) {
      var proj = Store.project(nodes[i].getAttribute('data-timer-project'));
      if (proj && proj.timer && proj.timer.runningSince) {
        nodes[i].textContent = fmtDuration(Store.elapsedMs(proj));
      }
    }
  }

  /* ================================================================== *
   * 23. Boot
   * ================================================================== */

  var booted = false;

  function init() {
    cacheEls();
    Store.load();

    if (window.Feedback && typeof window.Feedback.init === 'function') {
      window.Feedback.init(function () {
        return Store.settings();
      });
    }

    applyTheme(Store.settings().theme, false);
    bindEvents();

    // Craft modules registered while their scripts evaluated; now the shell is
    // ready they can add FAQ entries, tours and whatever else they need.
    craftOrder.forEach(function (id) {
      var d = craftDefs[id];
      if (d && typeof d.onInit === 'function') {
        try { d.onInit(ctx); } catch (e) { /* a broken module is not fatal */ }
      }
    });
    booted = true;

    render();
    window.setInterval(tick, 1000);
  }

  window.App = {
    init: init,
    render: render,
    toast: toast,
    confirmSheet: confirmSheet,
    openSheet: openSheet,
    closeAllSheets: closeAllSheets,
    openImportSheet: openImportSheet,
    openSettingsSheet: openSettingsSheet,
    openChecklistSheet: openChecklistSheet,
    startTour: startTour,
    startWelcomeTour: startWelcomeTour,
    applyTheme: applyTheme,
    // Crafts (docs/CRAFTS.md)
    registerCraft: registerCraft,
    crafts: craftList,
    ctx: ctx,
    pdfDropZone: pdfDropZone,
    version: APP_VERSION
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
