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

  /**
   * 05 #2: rounds vs rows is a property of the PIECE, not of the project. One
   * project-level word turned every part of an amigurumi whose every line says
   * `MR4` / `sc around` into a flat sheet. `Store.partWorkMode` resolves the
   * owner's explicit `Part.workMode`, then the pattern text, then the project.
   * Anything that labels one part's counter goes through these two.
   */
  function partMode(project, prt) {
    // wave K (E13): a knitting part the reader found worked in the round
    // (`Part.rowWord: 'rnd'`) says Rnd / Round, unless the knitter chose otherwise
    if (prt && prt.rowWord === 'rnd' && (!prt.workMode || prt.workMode === 'auto')) return 'rounds';
    if (prt && window.Store && typeof Store.partWorkMode === 'function') {
      try {
        return Store.partWorkMode(prt, project) === 'rounds' ? 'rounds' : 'rows';
      } catch (e) {
        /* fall through to the project's own word */
      }
    }
    return project && project.countMode === 'rounds' ? 'rounds' : 'rows';
  }

  function partRowWord(project, prt, caps) {
    var w = partMode(project, prt) === 'rounds' ? 'Round' : 'Row';
    return caps ? w.toUpperCase() : w;
  }

  function partShortRowWord(project, prt) {
    return partMode(project, prt) === 'rounds' ? 'Rnd' : 'Row';
  }

  /**
   * Wave G: rounds or rows for ONE row of a piece - the bee's wings are
   * worked in the round, then turned and worked in rows from row 3
   * (`Store.rowWorkMode`). Falls back to the piece's own word.
   */
  function rowModeAt(project, prt, row) {
    // wave K (E13): a knitting part read as worked in the round, row by row
    // (a flat heel inside it still says Row: `Line.workedIn: 'rows'`)
    if (prt && prt.rowWord === 'rnd' && (!prt.workMode || prt.workMode === 'auto')) {
      var ln = null;
      try { ln = row >= 1 && typeof Store.lineForRow === 'function' ? Store.lineForRow(prt, row) : null; } catch (e0) { ln = null; }
      return ln && ln.workedIn === 'rows' ? 'rows' : 'rounds';
    }
    if (prt && row >= 1 && window.Store && typeof Store.rowWorkMode === 'function') {
      try {
        return Store.rowWorkMode(prt, row, project) === 'rows' ? 'rows' : 'rounds';
      } catch (e) {
        /* fall through */
      }
    }
    return partMode(project, prt);
  }

  function rowWordAt(project, prt, row, caps) {
    var w = rowModeAt(project, prt, row) === 'rounds' ? 'Round' : 'Row';
    return caps ? w.toUpperCase() : w;
  }

  function shortRowWordAt(project, prt, row) {
    return rowModeAt(project, prt, row) === 'rounds' ? 'Rnd' : 'Row';
  }

  /** Wave G: the size groups of a project ([] for a one-size pattern). */
  function projectGroups(p) {
    return p && Array.isArray(p.groups) ? p.groups : [];
  }

  /** Wave G: "Medium · " in front of a part's name when the project has sizes. */
  function groupPrefix(p, prt) {
    return prt && prt.group && projectGroups(p).length ? prt.group + ' · ' : '';
  }

  /* ---- Which way up a piece was worked (3D wave C) ---- */

  var ORIENT_OPTIONS = [
    { id: 'auto', label: 'Auto' },
    { id: 'top-down', label: 'Top-down' },
    { id: 'bottom-up', label: 'Bottom-up' }
  ];

  /** The chip's own value — never a guess. @returns {'auto'|'top-down'|'bottom-up'} */
  function partOrientation(prt) {
    var v = prt && prt.orientation;
    return v === 'top-down' || v === 'bottom-up' ? v : 'auto';
  }

  /**
   * What Auto reads out of the pattern text for this piece, with the chip taken
   * out of the way. `Store.partShape` is the SAME resolver the model carries to
   * the renderer, so the hint can never promise a way up the geometry did not
   * draw (05 #2's lesson, applied to orientation).
   * @returns {boolean} whether the text reads as worked from the bottom
   */
  function autoUpsideDown(prt) {
    if (!prt || !window.Store || typeof Store.partShape !== 'function') return false;
    var tmp = {};
    for (var k in prt) if (prt.hasOwnProperty(k)) tmp[k] = prt[k];
    // A separate id: the Store memoises per part, and this is not that part.
    tmp.id = (prt.id || 'part') + ':orientpreview';
    tmp.orientation = 'auto';
    // wave H (knit-qa-2): the preview part reads with its project's craft
    if (!tmp.craft && typeof Store.craftOf === 'function') {
      try { var cr = Store.craftOf(prt); if (cr && cr !== 'crochet') tmp.craft = cr; } catch (e0) { /* crochet */ }
    }
    try {
      return !!Store.partShape(tmp).upsideDown;
    } catch (e) {
      return false;
    }
  }

  /**
   * The one line under / beside the orientation chips. Auto says which way it
   * went and where that came from; an explicit pick says what it means for the
   * 3D piece.
   * @param {'auto'|'top-down'|'bottom-up'} pick
   */
  function orientationHint(pick, prt) {
    if (pick === 'bottom-up') return 'Worked bottom-up — round 1 sits at the bottom.';
    if (pick === 'top-down') return 'Worked top-down — round 1 sits at the top.';
    return autoUpsideDown(prt) ? 'Auto — bottom-up from the pattern' : 'Auto — top-down';
  }

  /* ---- UK or US stitch names (Wave E: the Part.dialect chip) ---- */

  var DIALECT_OPTIONS = [
    { id: 'auto', label: 'Auto' },
    { id: 'uk', label: 'UK' },
    { id: 'us', label: 'US' }
  ];

  /** The chip's own value — never a guess. @returns {'auto'|'uk'|'us'} */
  function partDialectPick(prt) {
    var v = prt && prt.dialect;
    return v === 'uk' || v === 'us' ? v : 'auto';
  }

  /**
   * What Auto reads for this piece with the chip taken out of the way — the
   * piece's own text through `Store.partDialect`, the same resolver the model
   * carries to `expand` and so to the heights the 3D piece is drawn at.
   * @returns {'uk'|'us'|null}
   */
  function autoDialect(prt) {
    if (!prt || !window.Store || typeof Store.partDialect !== 'function') return null;
    var tmp = {};
    for (var k in prt) if (prt.hasOwnProperty(k)) tmp[k] = prt[k];
    // A separate id: the Store memoises per part, and this is not that part.
    tmp.id = (prt.id || 'part') + ':dialectpreview';
    tmp.dialect = 'auto';
    try {
      return Store.partDialect(tmp) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * The line beside the Terms chips. UK and US count the same, so this never
   * moves a stitch target; it says what it changes, which is how tall a `tr`
   * (and so the 3D piece) is.
   * @param {'auto'|'uk'|'us'} pick
   */
  function dialectHint(pick, prt, short) {
    if (pick === 'uk') return short ? 'UK: tr = US dc' : 'UK terms — a tr is a US dc. Counts do not change.';
    if (pick === 'us') return short ? 'US: tr = tall treble' : 'US terms — a tr is the tall treble. Counts do not change.';
    var d = autoDialect(prt);
    if (d === 'uk') return short ? 'Auto — UK, from the text' : 'Auto — UK terms from the pattern';
    if (d === 'us') return short ? 'Auto — US, from the text' : 'Auto — US terms from the pattern';
    return short ? 'Auto — not stated (US)' : 'Auto — the pattern does not say; read as US';
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
    els.banners = $('#app-banners');

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
    els.stitchActions = $('#stitch-actions');
    els.stitchBtn = $('#stitch-btn');
    els.stitchNumber = $('#stitch-number');
    els.stitchReadout = $('#stitch-readout');
    els.stitchDev = $('#stitch-dev');
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

  /**
   * The one live region, shared by every craft (through `ctx.announce`).
   *
   * Policy (UX sweep D7, Wave E) — the same in all three crafts: announce
   * MILESTONES, never a single stitch. A row / round done, a stitch group
   * done, a piece / part / project done, a colour done, a step done, a block
   * or cut count moved, and — only where there is no grouping to mark it —
   * every 50th stitch. Per-stitch speech would make the big button unusable
   * with a screen reader on.
   *
   * A19: it used to clear the region and write 30 ms later, so a second call
   * inside that window ("Cream done" then "Now stitching Teal") dropped the
   * first. Calls that land together are now spoken together.
   */
  /**
   * UX sweep D5 / A15 — keep keyboard focus across a rebuild. Every list in
   * the app is re-rendered by clearing and rebuilding it, so the button you
   * just pressed was destroyed under you and focus fell to <body> (tick three
   * checklist items with the keyboard and you started over three times).
   *
   * `preserveFocus(fn)` notes the focused element's key — `data-focus-key`,
   * else its id, else its aria-label — runs `fn`, and if that element is gone
   * afterwards, focuses its replacement (or, when the replacement is now
   * disabled, the first control in the same row). It never moves focus that
   * is still on a live element. Published as `ctx.preserveFocus` so the craft
   * modules get the same behaviour.
   * @template T
   * @param {function(): T} fn
   * @returns {T}
   */
  function preserveFocus(fn) {
    var a = document.activeElement;
    var key = null;
    if (a && a !== document.body && a.getAttribute) {
      if (a.getAttribute('data-focus-key')) key = ['data-focus-key', a.getAttribute('data-focus-key')];
      else if (a.id) key = ['id', a.id];
      else if (a.getAttribute('aria-label')) key = ['aria-label', a.getAttribute('aria-label')];
    }
    var scope = a && a.closest ? a.closest('dialog') : null;
    var out = fn();
    if (!key || (a && document.contains(a))) return out;
    var root = scope && document.contains(scope) ? scope : document;
    var hit = null;
    var all = root.querySelectorAll('[' + key[0] + ']');
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute(key[0]) === key[1]) { hit = all[i]; break; }
    }
    if (hit && (hit.disabled || hit.hidden)) {
      var row = hit.closest('.list-item, [data-focus-row]') || hit.parentNode;
      var alt = row ? focusablesIn(row) : [];
      hit = alt[0] || null;
    }
    if (hit) {
      try { hit.focus({ preventScroll: true }); } catch (e) { try { hit.focus(); } catch (e2) { /* ignore */ } }
    }
    return out;
  }

  var announceQueue = [];
  var announceTimer = null;

  function announce(text) {
    if (!els.live || !text) return;
    announceQueue.push(String(text));
    if (announceTimer) return;
    els.live.textContent = '';
    // A fresh text node in the next frame makes screen readers re-announce.
    announceTimer = window.setTimeout(function () {
      announceTimer = null;
      var said = announceQueue.join('. ');
      announceQueue = [];
      els.live.textContent = said;
    }, 30);
  }

  /**
   * Wave K (docs/wave-k/api/shell-ui.md §5): `ctx.counted(ev)` — the one
   * place a craft reports a count, so the policy above, the haptic / sound
   * and the progress node's value are the same in every craft. The policy is
   * the pure `WorkMode.countPolicy` (js/workmode.js): milestones speak, a
   * plain tap speaks only at the total or, with no grouping, every 50th.
   * @param {{n?:number,total?:number,unit?:string,units?:string,label?:string,
   *          kind?:string,groupSize?:number,say?:string,node?:HTMLElement,quiet?:boolean}} ev
   * @returns {{said: (string|null), fb: string}}
   */
  function counted(ev) {
    ev = ev || {};
    var r = window.WorkMode && typeof window.WorkMode.countPolicy === 'function'
      ? window.WorkMode.countPolicy(ev)
      : { say: ev.kind && ev.kind !== 'tap' && ev.kind !== 'undo' ? ev.say || null : null, fb: ev.kind || 'tap' };
    var node = ev.node;
    if (node && node.setAttribute) {
      var n = Math.max(0, Math.round(Number(ev.n) || 0));
      var total = Math.max(0, Math.round(Number(ev.total) || 0));
      var units = ev.units || (window.WorkMode ? window.WorkMode.plural(ev.unit || 'stitch') : 'stitches');
      var text = (ev.label ? ev.label + ': ' : '') + n + (total ? ' of ' + total : '') + ' ' + units;
      var role = node.getAttribute('role');
      if (role === 'progressbar' || role === 'meter' || role === 'slider' || role === 'spinbutton') {
        node.setAttribute('aria-valuenow', String(n));
        node.setAttribute('aria-valuemin', '0');
        if (total) node.setAttribute('aria-valuemax', String(total)); else node.removeAttribute('aria-valuemax');
        node.setAttribute('aria-valuetext', text);
      } else {
        // a button cannot carry a value: say it as its description instead
        node.setAttribute('aria-description', text);
      }
    }
    if (r.say) announce(r.say);
    if (!ev.quiet) fb(r.fb);
    return { said: r.say || null, fb: r.fb };
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
   * 5b. Top banners
   *
   * A persistent strip above every screen for the two things the user must
   * not be able to miss: a save that failed (13 #2, 09 #2) and another tab
   * that changed the same data (13 #1). They are `role="alert"`, they are not
   * dismissable, and they push the screens down rather than covering them.
   * ================================================================== */

  var banners = Object.create(null); // id -> node, so one id never stacks

  /** Screens read --banner-h; keep it in step with whatever is showing. */
  function syncBannerHeight() {
    if (!els.banners) return;
    var h = els.banners.childNodes.length ? els.banners.offsetHeight : 0;
    document.documentElement.style.setProperty('--banner-h', (h || 0) + 'px');
  }

  /**
   * @param {{id:string, tone?:'danger'|'calm', text:string,
   *          actions?:Array<{text:string, onClick:Function}>}} opts
   */
  function showBanner(opts) {
    if (!els.banners || !opts || !opts.id) return null;
    hideBanner(opts.id);
    var bar = el('div', 'banner banner-' + (opts.tone === 'calm' ? 'calm' : 'danger'));
    bar.setAttribute('role', 'alert');
    bar.setAttribute('data-banner', opts.id);
    bar.appendChild(el('p', 'banner-text', opts.text || ''));
    if (opts.actions && opts.actions.length) {
      var row = el('div', 'banner-actions');
      opts.actions.forEach(function (a) {
        var b = button('btn small', a.text);
        on(b, 'click', a.onClick);
        row.appendChild(b);
      });
      bar.appendChild(row);
    }
    banners[opts.id] = bar;
    els.banners.appendChild(bar);
    syncBannerHeight();
    return bar;
  }

  function hideBanner(id) {
    var node = banners[id];
    if (!node) return false;
    delete banners[id];
    if (node.parentNode) node.parentNode.removeChild(node);
    syncBannerHeight();
    return true;
  }

  /* ================================================================== *
   * 5c. Storage health (13 #2–#3, 09 #2) and multi-tab (13 #1)
   * ================================================================== */

  var QUOTA_TEXT = 'Your last taps are not saved. Free up space or download a backup.';
  var PRIVATE_TEXT = 'Private browsing: nothing will be saved after you close this tab.';

  /**
   * The craft module's own "make this project smaller" path, if it published
   * one. Cross-stitch has the counts-mode downgrade internally but does not
   * expose it on its registration yet, so today this returns null and the
   * button is simply not shown (see HANDOFF).
   */
  function freeUpSpaceAction() {
    var p = currentProject();
    var def = craftFor(p);
    if (!p || !def || typeof def.freeUpSpace !== 'function') return null;
    return {
      text: 'Free up space',
      onClick: function () {
        try { def.freeUpSpace(p.id, ctx); } catch (e) { /* the banner stays */ }
      }
    };
  }

  /** What raised the current storage banner, or null. */
  var storageBannerKind = null;

  /**
   * The banner is not dismissable by hand, but it should not outlive the
   * problem: once a write succeeds again (space freed, a backup taken) it
   * goes. Private mode is forever, so that one stays.
   */
  function syncStorageBanner() {
    if (!storageBannerKind || storageBannerKind === 'private') return;
    if (Store.saveFailed()) return;
    storageBannerKind = null;
    hideBanner('storage');
  }

  /** One banner, whatever kind of write failure put it there. */
  function showStorageBanner(kind) {
    var calm = kind === 'private';
    storageBannerKind = kind || 'quota';
    var actions = [];
    if (!calm) {
      actions.push({ text: 'Download backup', onClick: function () { exportBackup(); } });
      var free = freeUpSpaceAction();
      if (free) actions.push(free);
    }
    showBanner({
      id: 'storage',
      tone: calm ? 'calm' : 'danger',
      text: calm ? PRIVATE_TEXT : QUOTA_TEXT,
      actions: actions
    });
  }

  /**
   * "Your saved projects could not be read": the only screen that gets in the
   * way of everything, because the next write would destroy the evidence.
   */
  function openCorruptSheet() {
    var key = Store.corruptKey() || (Store.KEY + '.corrupt');
    openSheet({
      title: 'Your saved projects could not be read',
      cls: 'sheet-corrupt',
      locked: true,
      build: function (body) {
        body.appendChild(
          el(
            'p',
            null,
            'Something wrote a damaged copy of your data — a phone that shut down mid-save is the ' +
              'usual cause. Nothing has been thrown away: the unreadable text is still on this ' +
              'device under “' + key + '”.'
          )
        );
        body.appendChild(
          el(
            'p',
            'muted',
            'Download the copy first. Then “Start fresh” lets the app save again; send us the file ' +
              'and we can often get the projects back out of it.'
          )
        );
      },
      footer: [
        {
          text: 'Download the copy',
          cls: 'btn',
          onClick: function () {
            downloadCorruptSnapshot(key);
          }
        },
        {
          text: 'Start fresh',
          cls: 'btn primary',
          onClick: function (api) {
            confirmSheet({
              title: 'Start fresh?',
              message: 'The app will save again from now on. The damaged copy stays under “' + key + '”.',
              confirmText: 'Start fresh',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.acknowledgeCorrupt();
              api.close();
              render();
              toast('Starting fresh — the old copy is still on this device');
            });
          }
        }
      ]
    });
  }

  function downloadCorruptSnapshot(key) {
    var text = Store.corruptSnapshot();
    if (typeof text !== 'string' || !text) {
      toast('That copy is no longer available');
      return;
    }
    downloadText(text, String(key || 'stitchkeeper-corrupt') + '.json', 'application/json');
    toast('Copy downloaded');
  }

  /** One anchor-click download, shared by the backup and the corrupt copy. */
  function downloadText(text, filename, type) {
    try {
      return downloadBlob(new Blob([text], { type: type || 'application/json' }), filename);
    } catch (e) {
      return false;
    }
  }

  function downloadBlob(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // A 20 MB backup can still be streaming to disk after 1.5 s; the URL
      // only costs memory while it lives, so give it a generous minute.
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 'takeTheirs' re-emits onExternalChange; one toast is enough. */
  var resolvingConflict = false;

  function resolveConflictWith(how) {
    hideBanner('conflict');
    resolvingConflict = true;
    try {
      Store.resolveConflict(how);
    } catch (e) {
      /* the store keeps the flag; the banner comes back on the next event */
    }
    resolvingConflict = false;
    render();
    toast(how === 'takeTheirs' ? 'Using the other tab’s copy' : 'Kept this tab’s copy');
  }

  function showConflictBanner() {
    showBanner({
      id: 'conflict',
      tone: 'danger',
      text: 'This app is open in another tab and both made changes.',
      actions: [
        { text: 'Keep mine', onClick: function () { resolveConflictWith('keepMine'); } },
        { text: 'Use the other tab’s', onClick: function () { resolveConflictWith('takeTheirs'); } }
      ]
    });
  }

  /** Boot-time wiring; everything it subscribes to lives for the page's life. */
  function watchStorage() {
    var health;
    try {
      health = Store.storageHealth();
    } catch (e) {
      health = { writable: true, privateMode: false };
    }
    if (health && (health.privateMode || !health.writable)) {
      showStorageBanner(health.privateMode ? 'private' : 'unknown');
    } else if (Store.saveFailed()) {
      var last = Store.lastSaveError();
      showStorageBanner(last && last.kind ? last.kind : 'quota');
    }
    if (Store.isCorrupt()) openCorruptSheet();

    Store.onStorageError(function (e) {
      showStorageBanner(e && e.kind);
    });

    // Another tab wrote and we had nothing in flight: take it and say so.
    Store.onExternalChange(function () {
      if (resolvingConflict) return; // resolveConflictWith says it itself
      render();
      toast('Updated from another tab');
    });
    // Both tabs changed things: the user picks.
    Store.onConflict(showConflictBanner);
    if (Store.conflict()) showConflictBanner();

    window.addEventListener('resize', debounce(syncBannerHeight, 150));
    scheduleBlobSweep();
  }

  /**
   * 09 #10: page images whose project is gone (the tab closed inside the
   * 6-second delete-undo window, a crash mid-import) are never reclaimed by
   * anything else. Once per start, when the app is idle, delete every
   * 'p:<id>:' blob no project points at. "Points at" is wide on purpose —
   * the live list, the undo stack, the pre-import snapshot and whatever is on
   * disk from another tab (Store.referencedProjectIds) — and an unreadable
   * or conflicted store sweeps nothing.
   */
  /*
   * Wave K: the page images (IndexedDB) are shared by every store key on this
   * origin — the user's own and any test or agent profile — but a key only
   * knows its own projects. So the sweep (a) never runs when the store key
   * has changed since boot (`Store.__setKeyForTests`: a test page or an
   * agent's private profile), and (b) also keeps every project named in ANY
   * other `stitchkeeper*` key in localStorage. A real user's images can only
   * go when no store on the device mentions their project.
   */
  var sweepBootKey = null;

  /** Project ids every OTHER store key on this origin still holds (projects, and the undo / import copies it carries). */
  function otherStoreIds(currentKey) {
    var out = [];
    var ls = null;
    try { ls = window.localStorage; } catch (e) { ls = null; }
    if (!ls) return out;
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (!k || k === currentKey || !/^stitchkeeper/i.test(k)) continue;
      var raw = null;
      try { raw = ls.getItem(k); } catch (e2) { raw = null; }
      if (!raw || raw.charAt(0) !== '{') continue;
      // any "id" that looks like a project id inside "projects": cheap and wide on purpose
      try {
        var st = JSON.parse(raw);
        (st && Array.isArray(st.projects) ? st.projects : []).forEach(function (p) {
          if (p && typeof p.id === 'string' && out.indexOf(p.id) < 0) out.push(p.id);
        });
      } catch (e3) {
        // unreadable: keep everything its text names as p:<id>:
        var re = /p:([A-Za-z0-9_-]+):/g, m;
        while ((m = re.exec(raw))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
      }
    }
    return out;
  }

  /** The ids a sweep keeps: this store's referenced projects plus every other store key's. */
  function sweepLiveIds() {
    var mine = typeof Store.referencedProjectIds === 'function' ? Store.referencedProjectIds() : [];
    var all = mine.slice();
    otherStoreIds(Store.KEY).forEach(function (id) { if (all.indexOf(id) < 0) all.push(id); });
    return all;
  }

  /** @returns {Promise<{skipped?: string, count?: number, bytes?: number}>} */
  function runBlobSweep() {
    var B = window.BlobStore;
    if (!B || typeof B.sweep !== 'function' || typeof Store.referencedProjectIds !== 'function') return Promise.resolve({ skipped: 'unavailable' });
    try {
      if (Store.isCorrupt() || Store.conflict()) return Promise.resolve({ skipped: 'store' });
      if (sweepBootKey !== null && Store.KEY !== sweepBootKey) return Promise.resolve({ skipped: 'key changed' });
      if (!(Store.referencedProjectIds() || []).length) return Promise.resolve({ skipped: 'empty' });
      var ids = sweepLiveIds();
      return B.sweep(ids).then(function (r) {
        if (r && r.count && window.console) {
          console.info('BlobStore sweep: removed ' + r.count + ' orphaned page images (' + mb(r.bytes) + ')');
        }
        return r || { count: 0 };
      }, function () { return { skipped: 'failed' }; });
    } catch (e) {
      return Promise.resolve({ skipped: 'failed' });   // housekeeping; never in the user's way
    }
  }

  function scheduleBlobSweep() {
    var B = window.BlobStore;
    if (!B || typeof B.sweep !== 'function' || typeof Store.referencedProjectIds !== 'function') return;
    sweepBootKey = Store.KEY || null;
    var run = function () { runBlobSweep(); };
    window.setTimeout(function () {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 10000 });
      else run();
    }, 8000);
  }

  /* ---- persistent storage + the backup nag (12 #1, 09 #4) ---- */

  var persistAsked = false;

  /** Once per session, after the first row is actually finished. */
  function askForPersistOnce() {
    if (persistAsked) return;
    persistAsked = true;
    if (typeof Store.requestPersist !== 'function') return;
    try {
      Store.requestPersist();
    } catch (e) {
      /* a browser without the API simply never grants it */
    }
  }

  /** "61 MB" — one place so every size guard says it the same way. */
  function mb(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return Math.round(n / (1024 * 1024)) + ' MB';
  }

  /**
   * A PDF's own bytes never reach localStorage — only the text pulled out of
   * it does, and even a 200-page pattern is well under a megabyte of text. So
   * the PDF path asks "is there room for a megabyte?" rather than "is there
   * room for twice this file?", which would warn on every ordinary 3 MB
   * pattern however empty the storage was.
   */
  var PDF_TEXT_BUDGET = 1024 * 1024;

  /**
   * Pre-flight for anything that will end up in localStorage: text pulled out
   * of a PDF, a backup about to be merged in (09 #2). `file.size * 2` is the
   * bound on what the read will need, capped for PDFs as above.
   * @param {File} file
   * @param {string} what   named in the message
   * @param {number} [cap]  upper bound on the estimate
   * @returns {Promise<boolean>} false when the user backed out
   */
  function guardQuota(file, what, cap) {
    var bytes = file && file.size ? file.size * 2 : 0;
    if (cap && bytes > cap) bytes = cap;
    var tight = false;
    try {
      tight = !!(bytes && Store.wouldExceedQuota(bytes));
    } catch (e) {
      tight = false;
    }
    if (!tight) return Promise.resolve(true);
    return confirmSheet({
      title: 'Storage is nearly full',
      message:
        'There may not be room for ' + (what || 'this file') + ' (' + mb(file.size) + '). ' +
        'Download a backup first, or free up space — importing anyway may fail to save.',
      confirmText: 'Import anyway'
    });
  }

  /** iOS Safari that is not installed: Add to Home Screen is the real fix. */
  function isIOSDevice() {
    var ua = String(navigator.userAgent || '');
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function iosNotInstalled() {
    if (!isIOSDevice()) return false;
    if (navigator.standalone === true) return false;
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return false;
    } catch (e) { /* no matchMedia: treat as a browser tab */ }
    return true;
  }

  /** The one-line dismissible bar at the top of the home list. */
  function backupNagBar() {
    var status;
    try {
      status = Store.backupStatus();
    } catch (e) {
      return null;
    }
    if (!status || !status.due) return null;

    var bar = el('div', 'nag-bar');
    bar.setAttribute('role', 'note');
    var text = 'Your work lives only on this phone. Save a backup →';
    if (iosNotInstalled()) text += ' Add to Home Screen keeps it safer.';
    bar.appendChild(el('p', 'nag-text', text));

    var actions = el('div', 'nag-actions');
    // 13 / 12 #1: the bar's button makes the full .thready file (page images
    // included) and exportJSON stamps lastBackupAt, which is what clears it.
    var save = button('btn small primary', 'Back up now');
    on(save, 'click', function () {
      save.disabled = true;
      exportBackup().then(function () { renderHome(); });
    });
    var not = button('linkish', 'Not now');
    on(not, 'click', function () {
      Store.snoozeBackupNag(14);
      renderHome();
      toast('We’ll ask again in a couple of weeks');
    });
    actions.appendChild(save);
    actions.appendChild(not);
    bar.appendChild(actions);
    return bar;
  }

  /* ================================================================== *
   * 6. Sheets (dynamic <dialog>)
   * ================================================================== */

  var openSheets = [];
  var sheetSeq = 0;

  /**
   * @param {{title:string, cls?:string, build?:Function, footer?:Array,
   *          onClose?:Function,
   *          locked?:boolean,        // no ✕, no Escape, no backdrop close
   *          subject?:string         // a project id this sheet is *about*;
   *                                  // render() closes the sheet if it goes
   *         }} opts
   */
  function openSheet(opts) {
    opts = opts || {};
    var dlg = document.createElement('dialog');
    dlg.className = 'sheet' + (opts.cls ? ' ' + opts.cls : '');

    var inner = el('div', 'sheet-inner');
    var head = el('div', 'sheet-head');
    head.appendChild(el('div', 'sheet-grab'));
    var h = el('h2', 'sheet-title', opts.title || '');
    // Without this every sheet announces as an unnamed dialog.
    sheetSeq += 1;
    h.id = 'sheet-title-' + sheetSeq;
    dlg.setAttribute('aria-labelledby', h.id);
    var closeBtn = button('sheet-close', '✕', 'Close');
    if (opts.locked) closeBtn.hidden = true;
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
      /** The project this sheet edits, so render() can close it if it goes. */
      subject: opts.subject || null,
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
      if (opts.locked) return;
      if (e.target === dlg) api.close();
    });
    on(dlg, 'close', teardown);
    // Escape normally arrives as the dialog's own `cancel`, but only when
    // showModal() was available (see below) and only in engines that wire it
    // up. Closing here too makes Escape work everywhere; teardown is
    // idempotent, so a double close is harmless. Inputs that want Escape for
    // themselves (the inline checklist rename) stop it propagating.
    on(dlg, 'keydown', function (e) {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        if (!opts.locked) api.close();
      }
    });
    // A locked sheet (the corrupt-state recovery) must not be dismissed by the
    // dialog element's own cancel either.
    if (opts.locked) {
      on(dlg, 'cancel', function (e) { e.preventDefault(); });
    }

    if (opts.build) opts.build(body, api);

    openSheets.push(api);
    if (typeof dlg.showModal === 'function' && !forceSheetFallback) {
      dlg.showModal();
    } else {
      openFallbackSheet(dlg, api);
    }
    return api;
  }

  /** TEST/QA hook: `App.__forceSheetFallback(true)` drives the no-showModal path. */
  var forceSheetFallback = false;

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusablesIn(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (n) {
      return !n.hidden && n.getAttribute('aria-hidden') !== 'true' &&
        (n.offsetWidth > 0 || n.offsetHeight > 0 || n.getClientRects().length > 0);
    });
  }

  /**
   * UX sweep D3 / A14 — the sheet without `showModal` (older iOS Safari, which
   * the PWA targets). `setAttribute('open')` alone gave a non-modal dialog: no
   * top layer, no tint, no focus trap, and focus never came back. So on that
   * path the sheet brings its own: `.sheet-fallback` paints the backdrop and
   * lifts it above the app (the dialog already fills the viewport, so a tap on
   * the tint IS a tap on the dialog and the existing backdrop-close works),
   * `aria-modal` tells assistive tech, Tab wraps inside it, focus that escapes
   * is pulled back, and closing puts focus back where it was.
   */
  function openFallbackSheet(dlg, api) {
    var before = document.activeElement;
    dlg.classList.add('sheet-fallback');
    dlg.setAttribute('open', '');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('role', 'dialog');

    function topmost() {
      var open = openSheets.filter(function (s) { return s.dialog.classList.contains('sheet-fallback'); });
      return open.length && open[open.length - 1] === api;
    }
    function onKey(e) {
      if (e.key !== 'Tab' || !topmost()) return;
      var f = focusablesIn(dlg);
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function onFocusIn(e) {
      if (!topmost() || dlg.contains(e.target)) return;
      // The guided tour's card sits above sheets on purpose; leave it be.
      if (e.target && e.target.closest && e.target.closest('.tour-overlay, .tour-card, #toasts')) return;
      var f = focusablesIn(dlg);
      (f[0] || dlg).focus();
    }
    dlg.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn, true);
    if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');

    var close = api.close;
    api.close = function (value) {
      document.removeEventListener('focusin', onFocusIn, true);
      dlg.removeEventListener('keydown', onKey);
      close(value);
      if (before && before.focus && document.contains(before)) {
        try { before.focus(); } catch (e) { /* ignore */ }
      }
    };
    // showModal() focuses the first focusable; do the same.
    var f = focusablesIn(dlg);
    var target = f.filter(function (n) { return !n.classList.contains('sheet-close'); })[0] || f[0] || dlg;
    try { target.focus(); } catch (e) { /* ignore */ }
  }

  function closeAllSheets() {
    openSheets.slice().forEach(function (s) {
      s.close();
    });
  }

  /**
   * 13 #11: a sheet whose project has been deleted was left open over the home
   * screen, fully interactive, saving into nothing. Every sheet that names a
   * `subject` project is checked on each render and closes itself.
   */
  function closeOrphanSheets() {
    var gone = 0;
    openSheets.slice().forEach(function (s) {
      if (!s.subject) return;
      if (Store.project(s.subject)) return;
      gone++;
      s.close();
    });
    if (gone) toast('That project is gone, so its editor closed');
    return gone;
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
    wrap.setAttribute('role', 'group');
    var value = current;
    var buttons = {};
    /** Selection was only ever a class, which a screen reader cannot see. */
    function syncPressed() {
      Array.prototype.forEach.call(wrap.children, function (c) {
        c.setAttribute('aria-pressed', c.classList.contains('on') ? 'true' : 'false');
      });
    }
    options.forEach(function (o) {
      var b = button(value === o.id ? 'on' : null, o.label);
      buttons[o.id] = b;
      on(b, 'click', function () {
        value = o.id;
        Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        syncPressed();
        if (onPick) onPick(value);
      });
      wrap.appendChild(b);
    });
    syncPressed();
    return {
      node: wrap,
      get: function () { return value; },
      set: function (id) {
        if (!buttons[id]) return;
        value = id;
        Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('on'); });
        buttons[id].classList.add('on');
        syncPressed();
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

  /**
   * Wave H (docs/wave-h/CONTRACT.md §1) adds three optional fields:
   *   usesCounter: true      the project renders #screen-project, the crochet
   *                          counter, with every crochet feature (knitting)
   *   parser: 'Knits' | api  that craft's pattern parser, registered with
   *                          Store.registerCraftParser (parserExtras rides along)
   *   settingsFields(body, ctx)  the craft's section in Settings
   * plus `label` as an alias of `name`, `faq: [{q, a}]` for Settings → Help
   * and `menuItems(p)` / `tourId` honoured on a counter craft's ⋯ menu too.
   */
  function registerCraft(def) {
    if (!def || typeof def !== 'object') return null;
    var id = typeof def.id === 'string' ? def.id.trim() : '';
    if (!id || id === CROCHET.id) return null;
    if (!def.name && typeof def.label === 'string') def.name = def.label;
    if (!craftDefs[id]) craftOrder.push(id);
    craftDefs[id] = def;
    if (def.parser && window.Store && typeof Store.registerCraftParser === 'function') {
      try { Store.registerCraftParser(id, def.parser, def.parserExtras || null); } catch (e) { /* no parser: a plain counter */ }
    }
    // wave H: `faq: [{q, a}]` joins Settings → Help (same as ctx.addFaq)
    if (Array.isArray(def.faq)) def.faq.forEach(function (it) { addFaq(it); });
    // wave K: a craft's template hook (and settings defaults) reach the Store's
    // side (docs/wave-k/api/shell-data.md §1: Store.setCraftHooks)
    if ((def.template || def.settings) && window.Store && typeof Store.setCraftHooks === 'function') {
      var hooks = {};
      if (def.template && typeof def.template === 'object') hooks.template = def.template;
      if (def.settings && typeof def.settings === 'object') hooks.settings = def.settings;
      try { Store.setCraftHooks(id, hooks); } catch (e) { /* the store keeps today's behaviour */ }
    }
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

  /**
   * Wave K (00 gap 17): the words a craft's first run, empty states and drop
   * zone use — `def.copy = { dropLabel, homeEmpty, allDone, importEmpty,
   * newProjectHint }` — with the shell's own for crochet and knitting.
   * '' when nothing is set (the caller keeps its generic text).
   */
  var BUILTIN_COPY = {
    crochet: {
      allDone: 'Nothing on the hook right now — everything you have made is on the shelf below.',
      importEmpty: 'No rows found yet. Paste the instruction part of your pattern (e.g. “Rnd 1: 6 sc in MR (6)”).'
    },
    knitting: {
      allDone: 'Nothing on the needles right now — everything you have made is on the shelf below.',
      importEmpty: 'No rows found yet. Paste the instruction part of your pattern (e.g. “Row 1 (RS): K2, p2 to end”).',
      dropLabel: 'Drop a knitting pattern PDF here, or choose a file'
    }
  };

  function craftCopy(id, key) {
    var cid = id || CROCHET.id;
    var d = craftDefs[cid];
    var own = d && d.copy && typeof d.copy === 'object' ? d.copy[key] : null;
    if (typeof own === 'string' && own.trim()) return own.trim();
    var b = BUILTIN_COPY[cid];
    return b && typeof b[key] === 'string' ? b[key] : '';
  }

  /** True once more than one craft can be picked. */
  function multiCraft() {
    return craftOrder.length > 0;
  }

  /**
   * Wave H: crochet, or a craft registered with `usesCounter` (knitting) —
   * its projects are counted on #screen-project like crochet's.
   */
  function counterCraft(id) {
    var key = id || CROCHET.id;
    if (key === CROCHET.id) return true;
    var d = craftDefs[key];
    return !!(d && d.usesCounter);
  }

  /** The registered definition of a counter craft other than crochet, or null. */
  function counterCraftDef(id) {
    var d = id && id !== CROCHET.id ? craftDefs[id] : null;
    return d && d.usesCounter ? d : null;
  }

  /** The pattern parser a project / part / probe / craft id is read with. */
  function parserOf(x) {
    if (typeof Store.parserFor === 'function') {
      try { return Store.parserFor(x); } catch (e) { return null; }
    }
    return window.Patterns || null;
  }

  /** A project a craft MODULE paints (#screen-craft) — not crochet, not a counter craft. */
  function isCraftProject(p) {
    return !!(p && p.craft && p.craft !== CROCHET.id && !counterCraft(p.craft));
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
    // wave K: one count policy for every craft (shell-ui.md §5)
    counted: counted,
    // wave K (knit-ui P2): pattern text with the chosen size's number marked (<mark>, never innerHTML)
    fillSizeMarked: fillSizeMarked,
    // Wrap a list rebuild so keyboard focus survives it (UX sweep D5).
    preserveFocus: preserveFocus,
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
    addFaq: addFaq,

    // wave K (docs/wave-k/api/shell-ui.md): the shared check sheet, page viewer, share card
    check: {
      badge: function (v, o) { return window.CheckSheet ? window.CheckSheet.badge(v, o) : el('span'); },
      line: function (c, o) { return window.CheckSheet ? window.CheckSheet.line(c, o) : el('div'); },
      render: function (node, c, o) { return window.CheckSheet ? window.CheckSheet.render(node, c, o) : node; },
      open: function (c, o) { return openCheckSheet(c, o); },
      guard: function (c, o) {
        return window.CheckSheet ? window.CheckSheet.guard(c, confirmSheet, o) : Promise.resolve(true);
      },
      demote: function (btn, c) { return window.CheckSheet ? window.CheckSheet.demote(btn, c) : null; },
      fromCountReport: function (rep, o) { return window.CheckSheet ? window.CheckSheet.fromCountReport(rep, o) : null; },
      fromXStitch: function (c) { return window.CheckSheet ? window.CheckSheet.fromXStitch(c) : null; }
    },
    pageViewer: function (o) { return openPageViewerSheet(o); },
    // wave K: the opt-in text reader (shell-ui.md §9); never wired silently
    ocr: {
      LABEL: 'Read from a picture — check it',
      available: function () { return !!ocrApi(); },
      sizeLabel: function () { return ocrSizeLabel(); },
      ensure: function (o) { return ocrEnsure(o); },
      offerButton: function (o) { return ocrOfferButton(o); },
      mark: function (node, o) { return ocrMark(node, o); },
      check: function (r, o) { return ocrCheck(r, o); },
      /** "These pages are pictures, so there is no text to read." (+ the reader, where it runs) */
      noText: function () { return noTextMessage(); },
      /** the message a failed PDF read shows: the no-text one, else the error's own */
      failText: function (err) { return pdfFailText(err); }
    },
    sharePicture: function (projectId) { return openShareCard(projectId); }
  };

  /** The one check sheet (CheckSheet.open with the shell's own openSheet). */
  function openCheckSheet(check, opts) {
    if (!window.CheckSheet) return null;
    var o = {};
    var k;
    for (k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    o.openSheet = openSheet;
    return window.CheckSheet.open(check, o);
  }

  /** The one page viewer in a sheet (PageViewer.open with the shell's own openSheet). */
  function openPageViewerSheet(opts) {
    if (!window.PageViewer) return null;
    var o = {};
    var k;
    for (k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    o.openSheet = openSheet;
    return window.PageViewer.open(o);
  }

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

  /** Rebuild whatever screen is showing, keeping keyboard focus (D5). */
  function render() {
    preserveFocus(renderNow);
  }

  function renderNow() {
    closeOrphanSheets();
    syncStorageBanner();
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
      syncCraftNotice(p);
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

  /**
   * Wave H: a counter craft (knitting) whose parser is not loaded still
   * counts — rows, stitches, parts, everything typed by hand — but reads no
   * pattern text. One line under the part tabs says so; crochet never sees it.
   */
  function syncCraftNotice(p) {
    var n = document.getElementById('craft-notice');
    if (!n) return;
    var def = counterCraftDef(p && p.craft);
    var missing = !!(def && def.parser && !parserOf(p));
    n.hidden = !missing;
    n.textContent = missing
      ? craftInfo(p.craft).emoji + ' The ' + craftInfo(p.craft).name.toLowerCase() +
        ' pattern reader did not load, so this is a plain counter for now — your counts are safe.'
      : '';
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
    return crochetPartSummary(p, prt);
  }

  /** The terminal state of a part — the same test as the Store's own. */
  function partFinished(prt) {
    return !!(prt && prt.targetRows && prt.piecesDone >= prt.makeCount && prt.row >= prt.targetRows);
  }

  /**
   * Wave E — the home card's crochet line. It used to pair the COMPLETED row
   * count with the stitch target of the row AFTER it ("Rnd 1 · 0/12 sts" is
   * round 2's twelve), used the project's word for every piece, said "Rnd 0"
   * for a piece nobody had started (D9), and "Rnd 20 · 0 sts" for a finished
   * one. Now: the round being worked with its own target, "of N" when the
   * piece has a target, "piece 2 of 4" for a make-count, "done ✓" when it is.
   */
  function crochetPartSummary(p, prt) {
    var bits = [prt.name];
    // Wave G: a multi-size booklet - the card speaks for the size whose tab
    // is open ("Medium · Body · Rnd 3 of 17"), and its parts only
    if (prt.group && projectGroups(p).length) bits.unshift(prt.group);
    var mine = prt.group && projectGroups(p).length
      ? p.parts.filter(function (q) { return !q.group || q.group === prt.group; })
      : p.parts;
    if (partFinished(prt)) {
      bits.push(prt.makeCount > 1 ? 'all ' + prt.makeCount + ' done ✓' : 'done ✓');
      var left = 0;
      mine.forEach(function (q) { if (!partFinished(q)) left++; });
      if (mine.length > 1) {
        bits.push(left ? plural(left, 'part') + ' to go'
          : (mine !== p.parts ? 'every ' + prt.group + ' part done' : 'every part done'));
      }
      return bits.join(' · ');
    }
    if (!prt.row && !prt.stitch && !prt.piecesDone) {
      bits.push('not started yet');
      return bits.join(' · ');
    }
    var ri = Store.repeatInfo(prt);
    var word = shortRowWordAt(p, prt, ri.workingRow);
    bits.push(word + ' ' + ri.workingRow + (prt.targetRows ? ' of ' + prt.targetRows : ''));
    if (prt.makeCount > 1) bits.push('piece ' + Math.min(prt.piecesDone + 1, prt.makeCount) + ' of ' + prt.makeCount);
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
    // Wave G: "3 sizes" - the booklet's sizes are all in here
    var nSizes = isCraftProject(p) ? 0 : projectGroups(p).length;
    if (nSizes > 1) {
      meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(el('span', 'pc-sizes', nSizes + ' sizes'));
    }
    // A timer that has never run has nothing to say — "0:00:00" on every card
    // just crowds the line.
    if (Store.elapsedMs(p) || (p.timer && p.timer.runningSince)) {
      meta.appendChild(document.createTextNode(' · '));
      var t = el('span', 'pc-time', fmtDuration(Store.elapsedMs(p)));
      t.setAttribute('data-timer-project', p.id);
      meta.appendChild(t);
    }
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
    // "Your work lives only on this phone" — above the projects it is about.
    var nag = backupNagBar();
    if (nag) els.homeList.appendChild(nag);
    live.forEach(function (p) {
      els.homeList.appendChild(projectCard(p));
    });
    // Everything is finished or frogged: the shelf holds it all and this list
    // would otherwise be a silent blank space.
    if (all.length > 0 && live.length === 0) {
      // wave K: in the words of the craft the shelf holds (crochet: "on the hook")
      var shelfCrafts = {};
      all.forEach(function (q) { shelfCrafts[q.craft || CROCHET.id] = true; });
      var only = Object.keys(shelfCrafts);
      var doneText = (only.length === 1 && craftCopy(only[0], 'allDone')) ||
        'Nothing in progress right now — everything you have made is on the shelf below.';
      var allDone = el('p', 'muted home-all-done', doneText);
      els.homeList.appendChild(allDone);
    }

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

  /* ---- Wave G: one tab per size of a multi-size booklet ------------------ */

  function ensureSizeTabs() {
    if (els.sizeTabs && document.contains(els.sizeTabs)) return els.sizeTabs;
    var strip = el('div', 'size-tabs');
    strip.id = 'size-tabs';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Sizes');
    els.tabs.parentNode.insertBefore(strip, els.tabs);
    els.sizeTabs = strip;
    return strip;
  }

  /**
   * wave H (knit-qa): a knitting project's groups are the patterns of a book
   * (the sock ebook's eight socks), not sizes: "Remove this pattern",
   * "Speed Bump Socks" (not "Speed Bump Socks size").
   */
  function groupNoun(p) {
    if (!p || p.craft !== 'knitting') return 'size';
    // wave H (knit-qa-2): groups holding the same parts (the Sandnes raglan's
    // children's and ladies' halves) are size ranges, not patterns
    var by = {}, order = [];
    (p.parts || []).forEach(function (q) {
      if (!q.group) return;
      if (!by[q.group]) { by[q.group] = []; order.push(q.group); }
      by[q.group].push(String(q.name || '').toLowerCase().replace(/\s+\d+$/, '').trim());
    });
    if (order.length >= 2) {
      var sig = function (g) { return by[g].slice().sort().join('|'); };
      var s0 = sig(order[0]);
      if (order.every(function (g) { return sig(g) === s0; })) return 'size';
    }
    return 'pattern';
  }

  function groupLabel(p, name) {
    return groupNoun(p) === 'pattern' ? name : name + ' size';
  }

  function sizeTabLabel(p, name) {
    var prog = Store.groupProgress(p.id, name);
    var s = groupLabel(p, name);
    if (prog && prog.done) s += ', done';
    else if (prog && prog.started) s += ', ' + prog.partsDone + ' of ' + plural(prog.parts, 'part') + ' done';
    return s;
  }

  function pickSizeTab(p, name, focus) {
    Store.setActiveGroup(p.id, name);
    render();
    announce(groupLabel(p, name));
    if (focus) {
      var t = els.sizeTabs ? els.sizeTabs.querySelector('[data-focus-key="size-tab:' + name.replace(/"/g, '') + '"]') : null;
      if (t) { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
    }
  }

  /**
   * The size strip above the part chips: role=tablist, one tab per size, the
   * open size's parts in the strip below it (its tabpanel). Arrow keys / Home /
   * End move between sizes; the ⋯ at the end is the open size's menu. A
   * project with one size gets no strip at all.
   * @returns {string|null} the open size
   */
  function renderSizeTabs(p) {
    var groups = projectGroups(p);
    if (els.tabs.parentNode) els.tabs.parentNode.classList.toggle('has-sizes', groups.length > 0);
    if (!groups.length) {
      if (els.sizeTabs) { clear(els.sizeTabs); els.sizeTabs.hidden = true; }
      els.tabs.setAttribute('role', 'group');
      els.tabs.setAttribute('aria-label', 'Parts');
      els.tabs.removeAttribute('aria-labelledby');
      els.tabs.removeAttribute('tabindex');
      return null;
    }
    var strip = ensureSizeTabs();
    strip.hidden = false;
    strip.setAttribute('aria-label', groupNoun(p) === 'pattern' ? 'Patterns' : 'Sizes');
    clear(strip);
    var active = p.activeGroup || groups[0].name;
    var tabs = [];
    groups.forEach(function (g, gi) {
      var sel = g.name === active;
      var t = button('size-tab' + (sel ? ' active' : ''));
      t.id = 'size-tab-' + gi;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', sel ? 'true' : 'false');
      t.setAttribute('aria-controls', 'part-tabs');
      t.setAttribute('data-focus-key', 'size-tab:' + g.name.replace(/"/g, ''));
      t.tabIndex = sel ? 0 : -1;
      t.title = g.name;
      t.appendChild(el('span', 'size-tab-name', g.name));
      var prog = Store.groupProgress(p.id, g.name);
      if (prog && prog.done) t.appendChild(el('span', 'size-tab-done', ' ✓'));
      t.setAttribute('aria-label', sizeTabLabel(p, g.name));
      on(t, 'click', function () {
        if (!sel) pickSizeTab(p, g.name, false);
      });
      on(t, 'keydown', function (e) {
        var to = -1;
        if (e.key === 'ArrowRight') to = (gi + 1) % groups.length;
        else if (e.key === 'ArrowLeft') to = (gi - 1 + groups.length) % groups.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = groups.length - 1;
        if (to < 0 || to === gi) return;
        e.preventDefault();
        pickSizeTab(p, groups[to].name, true);
      });
      tabs.push(t);
      strip.appendChild(t);
    });
    var more = button('size-tab-more', '⋯', groupLabel(p, active) + ': options');
    more.setAttribute('aria-haspopup', 'dialog');
    more.setAttribute('data-focus-key', 'size-tab-more');
    on(more, 'click', function () { openSizeMenu(p.id, active); });
    strip.appendChild(more);
    // the part chips are the open size's panel
    var selTab = tabs[groups.map(function (g) { return g.name; }).indexOf(active)] || tabs[0];
    els.tabs.setAttribute('role', 'tabpanel');
    els.tabs.removeAttribute('aria-label');
    els.tabs.setAttribute('aria-labelledby', selTab.id);
    // keep the open tab in view on a 375 px screen (no vertical page scroll)
    if (selTab && strip.scrollWidth > strip.clientWidth) {
      var left = selTab.offsetLeft - strip.offsetLeft;
      if (left < strip.scrollLeft || left + selTab.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = Math.max(0, left - 16);
      }
    }
    return active;
  }

  /** A size tab's ⋯ menu: progress, "Make this size a template", "Remove this size". */
  function openSizeMenu(projectId, name) {
    var p = Store.project(projectId);
    if (!p) return;
    var prog = Store.groupProgress(p.id, name);
    openSheet({
      subject: projectId,
      title: groupLabel(p, name),
      build: function (body, api) {
        if (prog) {
          var line = prog.done ? 'Every part done ✓'
            : prog.partsDone + ' of ' + plural(prog.parts, 'part') + ' done' +
              (prog.rows ? ' · ' + prog.rowsDone + ' of ' + prog.rows + ' rows and rounds' : '');
          body.appendChild(el('p', 'muted size-menu-progress', line));
        }
        var list = el('div', 'list');
        var mk = button('menu-item');
        mk.appendChild(el('span', 'menu-icon', '🧵'));
        mk.appendChild(el('span', null, 'Make this ' + groupNoun(p) + ' a template'));
        on(mk, 'click', function () {
          api.close();
          var draft = Store.templateFromProject(p.id, { group: name });
          if (draft) openTemplateEditor({ draft: draft });
        });
        list.appendChild(mk);
        var rm = button('menu-item danger-item');
        rm.appendChild(el('span', 'menu-icon', '✂️'));
        rm.appendChild(el('span', null, 'Remove this ' + groupNoun(p)));
        var others = projectGroups(p).length > 1 || p.parts.some(function (q) { return !q.group; });
        rm.disabled = !others;
        if (!others) rm.setAttribute('title', 'The last ' + groupNoun(p) + ' cannot be removed');
        on(rm, 'click', function () {
          if (!others) return;
          api.close();
          var n = p.parts.filter(function (q) { return q.group === name; }).length;
          confirmSheet({
            title: 'Remove ' + (groupNoun(p) === 'pattern' ? name : 'the ' + name + ' size') + '?',
            message: 'Its ' + plural(n, 'part') + ' and their counts go from this project. Undo puts them back.',
            confirmText: 'Remove',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            var res = Store.removeGroup(p.id, name);
            if (!res) return;
            render();
            announce(groupLabel(p, name) + ' removed');
            toast(groupLabel(p, name) + ' removed', {
              ms: 6000,
              actionText: 'Undo',
              onAction: function () { Store.undo(); render(); announce(groupLabel(p, name) + ' back'); }
            });
          });
        });
        list.appendChild(rm);
        body.appendChild(list);
      }
    });
  }

  function renderTabs(p) {
    clear(els.tabs);
    // Wave G: with sizes, the strip shows the open size's parts (and any part
    // every size shares), under a tab strip of the sizes
    var openSize = renderSizeTabs(p);
    p.parts.forEach(function (prt) {
      if (openSize && prt.group && prt.group !== openSize) return;
      // wave H: two parts knitted two at a time share one tab
      if (knitPairTab(p, prt, openSize)) return;
      var isActive = prt.id === p.activePartId;
      var tab = button('tab' + (isActive ? ' active' : ''));
      // Its label changes when it becomes the current part; the key does not.
      tab.setAttribute('data-focus-key', 'part-tab:' + prt.id);
      tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      tab.setAttribute(
        'aria-label',
        prt.name + (isActive ? ' (current part — tap to edit)' : '')
      );
      // 13 #10: a 2,000-character part name used to wrap into a block that
      // filled the whole strip. The chip clips with an ellipsis; the full name
      // is still on the tooltip and in the accessible name.
      tab.title = prt.name;
      tab.appendChild(el('span', 'tab-name', prt.name));
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

  /**
   * A never-started timer showed "0:00:00", which ate 45px of a 375px header
   * and pushed the project name into an ellipsis. Show a clock until it has
   * something to report.
   */
  function timerChipText(p) {
    var ms = Store.elapsedMs(p);
    var running = !!(p.timer && p.timer.runningSince);
    return (!running && !ms) ? '⏱' : fmtDuration(ms);
  }

  function updateTimerChip(p) {
    if (!els.pTimer) return;
    els.pTimer.textContent = timerChipText(p);
    var running = !!(p.timer && p.timer.runningSince);
    els.pTimer.classList.toggle('running', running);
    els.pTimer.setAttribute('aria-label', (running ? 'Stop' : 'Start') + ' timer, ' + fmtDuration(Store.elapsedMs(p)));
  }

  /**
   * "Pattern says 36 · instructions add up to 24", or '' — from the
   * `printed` / `computed` pair `Store.roundDeviation` fills only when a
   * round's printed total disagrees with its own instructions.
   */
  function countCheckText(dev) {
    if (!dev || typeof dev.printed !== 'number' || typeof dev.computed !== 'number') return '';
    if (dev.printed === dev.computed) return '';
    return 'Pattern says ' + dev.printed + ' · instructions add up to ' + dev.computed;
  }

  /* ---- Wave F: count confidence, size, yarn, "go to row" -------------- */

  /**
   * One line per part (06 #1 / #8): "20 rounds · 10 counts computed · 1 count
   * disagrees with the pattern" — from `Patterns.countReport` via the Store.
   * Counts are per ROW ("Rnd 7-13" is seven). '' when there are no rows.
   * @param {Object} rep        Store.countReport(...)
   * @param {string} word       'round' / 'row'
   * @param {boolean} [inferred] makeCountInferred: say where the ×2 came from
   */
  function countLineText(rep, word, inferred) {
    if (!rep || !rep.rows) return '';
    var w = String(word || 'row').toLowerCase();
    var bits = [rep.rows + ' ' + w + (rep.rows === 1 ? '' : 's')];
    if (rep.computed) bits.push(rep.computed + (rep.computed === 1 ? ' count' : ' counts') + ' computed ≈');
    if (rep.missing) bits.push(rep.missing + ' with no count');
    if (rep.unresolved) bits.push(rep.unresolved + ' not given for your size');
    var d = rep.disagree ? rep.disagree.length : 0;
    if (d) bits.push(d + (d === 1 ? ' count disagrees' : ' counts disagree') + ' with the pattern');
    if (inferred) bits.push('made twice (from the assembly text)');
    return bits.join(' · ');
  }

  /**
   * The pattern text with the chosen size's number in every size list marked
   * (03 #13): "blo sc 88 (<mark>100</mark>, 108)". Fills `node` with text and
   * <mark> nodes only — never innerHTML of pattern text.
   */
  function fillSizeMarked(node, text, prt, proj) {
    clear(node);
    var s = String(text || '');
    var marks = [];
    var names = proj ? Store.sizeNames(proj) : [];
    var sp = parserOf(proj || prt);   // wave H: the project's own craft's parser
    if (names.length >= 2 && sp && typeof sp.sizeMarks === 'function') {
      try {
        var n = proj && proj.sizes && proj.sizes.length >= 2 ? proj.sizes.length : 0;
        marks = sp.sizeMarks(s, prt ? prt.sizeIndex || 0 : 0, n) || [];
      } catch (e) {
        marks = [];
      }
    }
    var at = 0;
    marks.forEach(function (m) {
      if (m.start < at) return;
      node.appendChild(document.createTextNode(s.slice(at, m.start)));
      node.appendChild(el('mark', 'size-mark', s.slice(m.start, m.end)));
      at = m.end;
    });
    node.appendChild(document.createTextNode(s.slice(at)));
  }

  /** "main color" stays as written; a bare yarn code reads "Yarn A". */
  function yarnLabel(name) {
    return String(name || '').trim();
  }

  /** '#hex' for a yarn name when one is known (the owner's pick or the word), else null. */
  function yarnHex(proj, name) {
    if (!name) return null;
    if (proj && Store.hasYarnColor(proj, name)) return Store.yarnColorFor(proj, name);
    var cp = parserOf(proj);   // wave H
    if (cp && typeof cp.colorHex === 'function') {
      try { return cp.colorHex(name) || null; } catch (e) { return null; }
    }
    return null;
  }

  function yarnSwatch(proj, name) {
    var sw = el('span', 'yarn-swatch');
    sw.setAttribute('aria-hidden', 'true');
    var hex = yarnHex(proj, name);
    if (hex) sw.style.background = hex;
    else sw.classList.add('unknown');
    return sw;
  }

  /** "Change to black at the end of this round" / "Change to black". */
  function yarnChangeText(change, p, prt) {
    if (!change) return '';
    var t = 'Change to ' + yarnLabel(change.to);
    if (change.at === 'end') t += ' at the end of this ' + partRowWord(p, prt).toLowerCase();
    return t;
  }

  /**
   * The yarn strip above the pattern line (02 #3, 10 #1): a swatch for the
   * yarn this row is worked in and, on the row where it happens, the change.
   * Built lazily (index.html is not this module's), hidden when the pattern
   * never names a yarn.
   */
  function ensureYarnLine() {
    if (els.yarnLine && document.contains(els.yarnLine)) return els.yarnLine;
    if (!els.patternLine || !els.patternLine.parentNode) return null;
    var row = el('div', 'yarn-line');
    row.id = 'yarn-line';
    row.hidden = true;
    els.patternLine.parentNode.insertBefore(row, els.patternLine);
    els.yarnLine = row;
    return row;
  }

  function updateYarnLine(p, prt, workingRow) {
    var row = ensureYarnLine();
    if (!row) return null;
    var info = null;
    try { info = Store.rowColorInfo(prt, workingRow); } catch (e) { info = null; }
    // Wave G: the row where a piece begun in the round turns and goes on in
    // rows (the bee's wings, row 3) shares this one strip with a colour change
    var turn = turnsToRows(p, prt, workingRow) && !partFinished(prt);
    if ((!info || (!info.color && !info.change) || partFinished(prt)) && !turn) {
      row.hidden = true;
      clear(row);
      return null;
    }
    clear(row);
    // The yarn a row is worked in rides in the pattern line's tag as a
    // swatch (yarnTagSwatch); the strip itself only appears on the row where
    // the yarn changes, as one line, so the counter keeps its height.
    var said = [];
    if (info && info.change && !partFinished(prt)) {
      var ch = el('span', 'yarn-change');
      if (info.change.at === 'end' && info.color) {
        ch.appendChild(yarnSwatch(p, info.color));
        ch.appendChild(el('span', 'yarn-arrow', '→'));
      }
      ch.appendChild(yarnSwatch(p, info.change.to));
      ch.appendChild(el('span', 'yarn-text', yarnChangeText(info.change, p, prt)));
      row.appendChild(ch);
      said.push(yarnChangeText(info.change, p, prt) +
        (info.change.at === 'end' && info.color ? ' (working in ' + yarnLabel(info.color) + ')' : ''));
    }
    if (turn) {
      var tn = el('span', 'yarn-change turn-change');
      tn.appendChild(el('span', 'turn-icon', '↻'));
      tn.appendChild(el('span', 'yarn-text', 'Turn · rows from here'));
      row.appendChild(tn);
      said.push('Turn: worked in rows from this row on');
    }
    if (!said.length) {
      row.hidden = true;
      return info;
    }
    row.setAttribute('role', 'note');
    row.setAttribute('aria-label', said.join('. '));
    row.classList.add('changing');
    row.hidden = false;
    return info;
  }

  /** Wave G: this row is the first one worked in rows after rounds. */
  function turnsToRows(p, prt, row) {
    return row > 1 && rowModeAt(p, prt, row) === 'rows' && rowModeAt(p, prt, row - 1) === 'rounds';
  }

  // wave G: the sentence the turn strip already says
  var ROWS_SWITCH_NOTE_RE = /\binstead\s+of\s+(?:crocheting|working)\s+in\s+(?:the\s+)?round|\b(?:crochet(?:ing)?|work(?:ing)?)\s+in\s+['"]?rows\b/i;

  /** The current yarn as a swatch in front of "RND 15" (wave F). */
  function yarnTagSwatch(p, info) {
    if (!els.patternTag || !info || !info.color) return;
    var sw = yarnSwatch(p, info.color);
    sw.classList.add('yarn-tag-swatch');
    sw.removeAttribute('aria-hidden');
    sw.setAttribute('role', 'img');
    sw.setAttribute('aria-label', 'Yarn: ' + yarnLabel(info.color));
    sw.title = yarnLabel(info.color);
    els.patternTag.insertBefore(sw, els.patternTag.firstChild);
  }

  /** The "≈ why?" badge beside the stitch readout (06 #1): tap for the reason. */
  function ensureCountWhy() {
    if (els.countWhy) return els.countWhy;
    if (!els.stitchReadout) return null;
    // It rides at the end of the readout line (re-appended after every
    // readout write), so it costs the counter no height of its own.
    var b = button('count-why', '≈ why?', 'Why this count');
    b.hidden = true;
    on(b, 'click', function () {
      var p = currentProject();
      var prt = p ? Store.activePart(p) : null;
      if (p && prt) openCountWhySheet(p, prt);
    });
    els.countWhy = b;
    return b;
  }

  /**
   * What the count on this row rests on, in words: printed, worked out from
   * the instructions (≈), printed but contradicted by its own arithmetic, or
   * printed as a list that is not one number per size. Null when the row has
   * a plain printed count (nothing to explain).
   */
  function countWhy(p, prt) {
    var ri = Store.repeatInfo(prt);
    var line = Store.lineForRow(prt, ri.patternRow);
    if (!line) return null;
    var word = partRowWord(p, prt).toLowerCase();
    var tag = partShortRowWord(p, prt) + ' ' + ri.patternRow;
    var target = Store.currentTarget(prt);
    var dev = null;
    try { dev = Store.roundDeviation(prt); } catch (e) { dev = null; }
    var chk = countCheckText(dev);
    if (line.sizeUnresolved && Array.isArray(line.sizes)) {
      var names = Store.sizeNames(p);
      return {
        kind: 'size', tag: tag, line: line, short: '?',
        text: 'The pattern lists ' + line.sizes.length + ' numbers here (' + line.sizes.join(', ') + ') but names ' +
          names.length + ' sizes, so they are not one per size — they may be lengths or another choice. ' +
          'No stitch target is set for this ' + word + '; count from the pattern.'
      };
    }
    if (chk) {
      return {
        kind: 'disagree', tag: tag, line: line, short: '≠',
        text: chk + '. The target stays the printed ' + dev.printed + ' — the pattern is quoted, never corrected — ' +
          'but check this ' + word + ' before you finish it.'
      };
    }
    if (line.approxRow) {
      // the tape sentence this row's number was counted past
      var lenLine = null;
      var all = Store.linesFor(prt);
      for (var li = 0; li < all.length && all[li] !== line; li++) {
        if (all[li] && all[li].lengthEstimate) lenLine = all[li];
      }
      var le = lenLine ? lenLine.lengthEstimate : null;
      var said = le ? '“' + String(lenLine.text).replace(/\s+/g, ' ').slice(0, 90) + '”' : 'an “until it measures …” sentence';
      return {
        kind: 'approxRow', tag: '≈ ' + tag, line: line, short: '≈',
        text: 'The pattern does not number this ' + word + '. It comes after ' + said +
          ', so it is counted on from the last counted ' + word + ' and your real ' + word + ' number may differ' +
          (le && le.rows ? ' (the pattern’s gauge puts ' + le.value + (le.unit === 'in' ? '"' : ' ' + le.unit) + ' at about ' + le.rows + ' ' + word + 's' + (le.fromStart ? ' from the very beginning' : '') + ')' : '') +
          '. Measure your piece and set the ' + word + ' count by tapping the big number if it differs.' +
          (target && Store.isComputed(line) ? ' Its stitch count ≈ ' + target + ' is worked out from the instructions.' : '')
      };
    }
    if (target && Store.isComputed(line)) {
      return {
        kind: 'computed', tag: tag, line: line, short: '≈',
        text: 'The pattern prints no stitch count for ' + tag + '. ' + target +
          ' is worked out from its instructions and the ' + word + ' before it, so it is shown as ≈ ' + target + '.'
      };
    }
    return null;
  }

  function openCountWhySheet(p, prt) {
    var why = countWhy(p, prt);
    if (!why) return;
    openSheet({
      subject: p.id,
      title: { computed: 'Where ≈ comes from', approxRow: 'Why this row number is ≈', size: 'No count for your size' }[why.kind] ||
        'The pattern disagrees with itself',
      build: function (body) {
        body.appendChild(el('p', 'why-text', why.text));
        var q = el('div', 'why-line');
        q.appendChild(el('span', 'pattern-line-tag', why.tag));
        var t = el('span', 'why-line-text');
        fillSizeMarked(t, why.line.text, prt, p);
        q.appendChild(t);
        body.appendChild(q);
        var rep = Store.countReport(prt);
        var all = countLineText(rep, partRowWord(p, prt), !!prt.makeCountInferred);
        if (all) body.appendChild(el('p', 'muted why-part', prt.name + ': ' + all));
        // wave K: every row of the part against the pattern, in the shared check sheet
        if (window.CheckSheet && rep && rep.rows) {
          var whole = button('linkish check-open', 'See every ' + partRowWord(p, prt).toLowerCase() + ' checked');
          on(whole, 'click', function () {
            var lines = null;
            try { lines = Store.linesFor(prt); } catch (e) { lines = null; }
            openCheckSheet(window.CheckSheet.fromCountReport(rep, {
              word: partRowWord(p, prt), name: prt.name, lines: lines
            }));
          });
          body.appendChild(whole);
        }
      },
      footer: [{ text: 'OK', cls: 'btn primary', onClick: function (api) { api.close(); } }]
    });
  }

  /**
   * 03 #5 / #6: tap the big row number to set it. A number field, pre-filled
   * with the count the counter shows (rows COMPLETED, as the big number is),
   * focused and selected; Enter sets it. Undoable — it is the same
   * `Store.jumpToRow` the pattern sheet's "Jump to row" uses.
   */
  function openGoToRowSheet(p, prt) {
    var word = partRowWord(p, prt).toLowerCase();
    var max = prt.targetRows ? prt.targetRows : 99999;
    var input = numInput(prt.row, 0, max);
    input.setAttribute('aria-label', partRowWord(p, prt) + 's completed');
    input.setAttribute('enterkeyhint', 'done');
    var hint = el('div', 'field-hint');
    hint.setAttribute('aria-live', 'polite');
    function value() {
      var v = parseInt(input.value, 10);
      if (!isFinite(v) || v < 0) return null;
      return Math.min(v, max);
    }
    function sync() {
      var v = value();
      hint.textContent = v === null
        ? 'Type how many ' + word + 's are done.'
        : 'The counter will show ' + v + ' — you will be working ' + word + ' ' + (v + 1) +
          (prt.targetRows ? ' of ' + prt.targetRows : '') + ', stitches back to 0.';
    }
    function commit(api) {
      var v = value();
      if (v === null) { input.focus(); return; }
      if (v === prt.row) { api.close(); return; }
      Store.jumpToRow(p.id, prt.id, v + 1);
      api.close();
      render();
      announce('Working ' + word + ' ' + (v + 1));
    }
    var sheetApi = null;
    openSheet({
      subject: p.id,
      title: 'Set the ' + word + ' count',
      build: function (body, api) {
        sheetApi = api;
        var stepRow = el('div', 'goto-row');
        var minus = button('round-btn', '–', 'One ' + word + ' fewer');
        var plus = button('round-btn', '+', 'One ' + word + ' more');
        on(minus, 'click', function () { var v = value(); input.value = String(Math.max(0, (v === null ? prt.row : v) - 1)); sync(); });
        on(plus, 'click', function () { var v = value(); input.value = String(Math.min(max, (v === null ? prt.row : v) + 1)); sync(); });
        stepRow.appendChild(minus);
        stepRow.appendChild(input);
        stepRow.appendChild(plus);
        body.appendChild(field(partRowWord(p, prt) + 's completed', stepRow));
        body.appendChild(hint);
        on(input, 'input', sync);
        on(input, 'keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); commit(api); }
        });
        sync();
        window.setTimeout(function () {
          try { input.focus(); input.select(); } catch (e) { /* ignore */ }
        }, 30);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        { text: 'Set', cls: 'btn primary', onClick: function (api) { commit(api); } }
      ]
    });
    return sheetApi;
  }

  /** Make the big row number a keyboard-reachable control, once. */
  function bindRowNumber() {
    var n = els.rowNumber;
    if (!n || n.getAttribute('data-goto') === '1') return;
    n.setAttribute('data-goto', '1');
    n.setAttribute('role', 'button');
    n.setAttribute('tabindex', '0');
    n.classList.add('row-number-btn');
    function go() {
      var p = currentProject();
      var prt = p ? Store.activePart(p) : null;
      if (p && prt) openGoToRowSheet(p, prt);
    }
    on(n, 'click', go);
    on(n, 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); go(); }
    });
  }

  /** "Size M" beside the ROW label, so the counter says whose numbers these are. */
  function sizeTagText(p, prt) {
    var info = Store.partSize(p, prt);
    if (!info.label) return '';
    return info.label;
  }

  /** Fast path: only the numbers and readouts. */
  function updateCounters(p, prt) {
    if (!p || !prt) return;

    // Wave G: the word for the row being WORKED - the bee's wings turn from
    // rounds into rows at row 3 - and, in a multi-size project, whose part
    // this is ("Medium · Body") in front of it.
    var riHead = Store.repeatInfo(prt);
    var headWord = rowWordAt(p, prt, riHead.workingRow);
    els.rowLabel.textContent = '';
    var gp = groupPrefix(p, prt);
    if (gp) els.rowLabel.appendChild(el('span', 'row-group-tag', gp + prt.name + ' · '));
    els.rowLabel.appendChild(document.createTextNode(headWord.toUpperCase()));
    // Wave F (size-once): whose numbers these are, beside the word.
    var sizeTag = sizeTagText(p, prt);
    if (sizeTag) els.rowLabel.appendChild(el('span', 'row-size-tag', ' · ' + sizeTag));
    els.rowNumber.textContent = String(prt.row);
    // 03 #6: the number is a control — tap (or Enter) to set it.
    bindRowNumber();
    // (the number counts COMPLETED rows: their word, not the next row's)
    var doneWord = rowWordAt(p, prt, Math.max(1, prt.row));
    els.rowNumber.setAttribute('aria-label',
      (gp ? gp + prt.name + '. ' : '') +
      doneWord + 's done: ' + prt.row + '. Set the ' + doneWord.toLowerCase() + ' count');

    if (prt.targetRows) {
      els.rowProgress.hidden = false;
      var pct = Math.max(0, Math.min(100, (prt.row / prt.targetRows) * 100));
      els.rowBarFill.style.width = pct + '%';
      // Wave F (03 #5): a row total read off a tape measure is an estimate.
      var lbl = prt.row + ' / ' + (Store.targetApprox(prt) ? '≈ ' : '') + prt.targetRows;
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
          'Repeat ' + ri.k + ' of ' + ri.times + ' · ' + partRowWord(p, prt).toLowerCase() + ' ' + ri.j + ' of ' + ri.len;
      } else {
        els.repeat.textContent =
          'Repeat ' + partRowWord(p, prt).toLowerCase() + 's ' + prt.repeat.startRow + '–' + prt.repeat.endRow +
          ' × ' + prt.repeat.times + ' (not in repeat)';
      }
    } else {
      els.repeat.hidden = true;
    }

    // Setup / foundation line — only while the first row is being worked.
    var setup = ri.workingRow === 1 ? Store.setupLine(prt) : null;
    if (setup && setup.text && els.setupLine) {
      els.setupLine.hidden = false;
      fillSizeMarked(els.setupText, setup.text, prt, p);
    } else if (els.setupLine) {
      els.setupLine.hidden = true;
    }

    // Pattern line
    var line = Store.lineForRow(prt, ri.patternRow);
    // Wave F (02 #3): the yarn this row is worked in, and the change on the
    // row where it happens.
    var yarnInfo = updateYarnLine(p, prt, ri.workingRow);

    if (line && line.text) {
      els.patternLine.hidden = false;
      // "≈ Row 25": the parser numbered this row after an unresolved length
      els.patternTag.textContent = (line.approxRow ? '≈ ' : '') + shortRowWordAt(p, prt, ri.patternRow) + ' ' + ri.patternRow;
      yarnTagSwatch(p, yarnInfo);
      // Wave F: the chosen size's number marked in every size list.
      fillSizeMarked(els.patternText, line.text, prt, p);
      var notes = Store.notesOf(line);
      // wave G: on the turning row the strip above says "rows from here"
      if (turnsToRows(p, prt, ri.patternRow)) {
        notes = notes.filter(function (n) { return !ROWS_SWITCH_NOTE_RE.test(n); });
      }
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
    if (partFinished(prt)) {
      // Wave E: a finished piece has no row being worked, and "Group 1 ·
      // stitch 0 of 10" under a full progress bar was a number about nothing.
      readout = 'All ' + prt.targetRows + ' ' + partRowWord(p, prt).toLowerCase() + 's done';
    } else if (g > 0) {
      // wave I (group-readout): the row's own repeat groups when it has them
      // ("Group 1 of 6 · stitch 0 of 4"), else groups of the project's size
      readout = Store.groupReadout(prt, prt.stitch, g, target, approx);
    } else {
      // Grouping off: just the plain stitch number.
      readout = 'stitch ' + prt.stitch;
    }
    // wave H (knit-qa-2): a knitted row the pattern gives no total for (the
    // boyfriend's Shape Neck starts from stitches nothing counted) says so —
    // never a 0 — except in short rows, which count to the turn
    if (!partFinished(prt) && !target && line && line.kind === 'row' && isKnit(p) &&
        !(typeof Store.shortRowInfo === 'function' && Store.shortRowInfo(prt))) {
      readout += ' · count unknown';
    }
    els.stitchReadout.textContent = readout;
    // Wave F (06 #1): "≈" (and a count that disagrees, or none for your size)
    // is tappable — it says what the number rests on.
    var whyBtn = ensureCountWhy();
    if (whyBtn) {
      var why = partFinished(prt) ? null : countWhy(p, prt);
      whyBtn.hidden = !why;
      if (why) els.stitchReadout.appendChild(whyBtn);
      if (why) {
        whyBtn.textContent = why.short + ' why';
        whyBtn.setAttribute('aria-label', {
          computed: 'Why the count is approximate',
          approxRow: 'Why the row number is approximate',
          size: 'Why there is no count for your size'
        }[why.kind] || 'Why the pattern disagrees with itself');
        whyBtn.classList.toggle('warn', why.kind === 'size' || why.kind === 'disagree');
      }
    }

    if (target) {
      els.stitchProgress.hidden = false;
      var spct = Math.max(0, Math.min(100, (prt.stitch / target) * 100));
      els.stitchBarFill.style.width = spct + '%';
      els.stitchBarLabel.textContent = prt.stitch + ' / ' + approx + target;
    } else {
      els.stitchProgress.hidden = true;
    }

    /* 05 #6 — my count vs the pattern's, in one quiet line. Tapping 29 into a
       24-stitch round used to draw a complete, happy, correctly closed ring of
       29 and say nothing. Never modal, and only when the pattern actually
       stated a count for this round (`Store.roundDeviation` returns
       expected = null otherwise). */
    if (els.stitchDev) {
      var dev = null;
      try {
        dev = Store.roundDeviation(prt);
      } catch (e) {
        dev = null;
      }
      var lines = [];
      if (dev && dev.delta > 0) lines.push(dev.delta + ' more than the pattern’s ' + dev.expected);
      /* Wave E: the round's printed total and what its own instructions add
         up to disagree (Baphomet R29 prints 36, "(2sc, dec)x8" makes 24). The
         target stays the printed number — the pattern is quoted, never
         corrected — but the maker is told before the round goes wrong. */
      var chk = countCheckText(dev);
      if (chk && !partFinished(prt)) lines.push(chk);
      // Wave F (size-once): a list that is not one number per size gives no
      // target at all — say why the bar is missing rather than leave a blank.
      if (line && line.sizeUnresolved && Array.isArray(line.sizes) && !partFinished(prt)) {
        lines.push('Pattern lists ' + line.sizes.join(' / ') + ' here — not one per size');
      }
      if (lines.length) {
        els.stitchDev.hidden = false;
        els.stitchDev.textContent = lines.join(' · ');
      } else {
        els.stitchDev.hidden = true;
        els.stitchDev.textContent = '';
      }
    }

    // the "tap" hint has done its job once this piece has any stitches on it,
    // and its strip goes back to the 3D piece with it
    if (els.stitchBtn) {
      var counted = prt.stitch > 0 || prt.row > 0;
      if (els.stitchBtn.classList.contains('counted') !== counted) {
        els.stitchBtn.classList.toggle('counted', counted);
        syncDiagramInsets();
      }
    }

    // wave H: RS/WS, cable ring, short rows, markers, chart, length, pair
    updateKnitWidgets(p, prt);

    // wave I: the working mode's heads-up layer mirrors all of the above
    updateWorkHud(p, prt);
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
    // wave I: the working mode this project was left in, before the counters paint
    syncWorkMode(p);
    updateCounters(p, prt);
    updateBottomBar(p, prt);
    mountLiveDiagram();
  }

  /* ================================================================== *
   * 13b. Render — craft project (#screen-craft)
   * ================================================================== */

  function updateCraftTimerChip(p) {
    if (!els.cTimer) return;
    els.cTimer.textContent = timerChipText(p);
    var running = !!(p.timer && p.timer.runningSince);
    els.cTimer.classList.toggle('running', running);
    els.cTimer.setAttribute('aria-label', (running ? 'Stop' : 'Start') + ' timer, ' + fmtDuration(Store.elapsedMs(p)));
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

  /** Wave K: "Opening the chart…", or the honest card when part of it is gone. */
  function heavyWaitCard(p, state) {
    var card = el('section', 'card craft-missing heavy-wait');
    card.appendChild(el('div', 'craft-missing-emoji', craftInfo(p.craft).emoji));
    if (state === 'missing') {
      card.appendChild(el('h2', 'craft-missing-title', 'Part of this project is missing'));
      card.appendChild(el('p', 'muted',
        'Some of its saved data could not be found on this device (the browser may have cleared it). ' +
        'A backup made earlier still has it: Settings → Import backup. Or open what is left.'));
      if (typeof Store.discardMissingHeavy === 'function') {
        var go = button('btn block', 'Open what is left');
        on(go, 'click', function () {
          confirmSheet({
            title: 'Open what is left?',
            message: 'The missing part stays missing. You can Undo this straight after.',
            confirmText: 'Open it'
          }).then(function (ok) {
            if (!ok) return;
            try { Store.discardMissingHeavy(p.id); } catch (e) { /* ignore */ }
            render();
          });
        });
        card.appendChild(go);
      }
      var back = button('btn primary block', 'Back to projects');
      on(back, 'click', goHome);
      card.appendChild(back);
    } else {
      var t = el('p', 'muted', 'Opening ' + p.name + '…');
      t.setAttribute('role', 'status');
      card.appendChild(t);
    }
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

    // wave K (shell-data.md §4): a project whose big craft data lives in
    // IndexedDB is read back before its craft paints it
    var hs = typeof Store.heavyState === 'function' ? Store.heavyState(p.id) : 'none';
    if (hs && hs !== 'none' && hs !== 'ready') {
      destroyCraftProject();
      clear(els.craftBody);
      els.craftBody.appendChild(heavyWaitCard(p, hs));
      if (hs !== 'missing' && typeof Store.whenReady === 'function') {
        Store.whenReady(p.id).then(function () {
          var cp = currentProject();
          if (cp && cp.id === p.id) render();
        }, function () { /* the card stays; the next render asks again */ });
      }
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
      return;
    }
    // wave K: the craft's working mode, if it registered one (shell-ui.md §1)
    syncCraftWork(p, def);
  }

  /* ---- wave K: working mode for a #screen-craft craft (def.workMode) ---- */

  var craftWork = Object.create(null);   // craft id → WorkMode session

  function craftWorkSpec(def) {
    var spec = def && def.workMode;
    return spec && typeof spec === 'object' ? spec : null;
  }

  function craftWorkSession(def) {
    var spec = craftWorkSpec(def);
    if (!spec || !els.craft || !window.WorkMode || typeof window.WorkMode.create !== 'function') return null;
    var s = craftWork[def.id];
    if (s && s.source === spec) return s;
    if (s) s.destroy();
    // the shell's defaults under the craft's own spec (never mutated)
    var full = Object.create(spec);
    if (!spec.label) full.label = 'Working mode';
    if (!spec.backTo) full.backTo = 'the project';
    if (!spec.hudId) full.hudId = 'work-hud-' + def.id;
    s = window.WorkMode.create(els.craft, full, workEnv(els.craft));
    s.source = spec;
    craftWork[def.id] = s;
    return s;
  }

  function craftWorkWanted(p) {
    if (!p || !isCraftProject(p)) return false;
    if (typeof Store.focusMode === 'function') return !!Store.focusMode(p.id);
    return work.fallbackId === p.id;
  }

  function syncCraftWork(p, def) {
    Object.keys(craftWork).forEach(function (id) {
      if (!def || id !== def.id) craftWork[id].sync(false);
    });
    var s = craftWorkSession(def);
    if (s) s.sync(craftWorkWanted(p));
  }

  /** The working-mode session for whatever project is open (counter or craft), or null. */
  function currentWorkSession() {
    var p = currentProject();
    if (!p) return null;
    if (isCraftProject(p)) return craftWorkSession(craftFor(p));
    return ensureWorkSession();
  }

  /** ctx.workMode: the shell's working-mode door for a craft's own screen. */
  var workModeApi = {
    supported: function () { return !!window.WorkMode; },
    open: function () {
      var p = currentProject();
      if (p && !isCraftProject(p)) { openWorkMode(); return true; }
      var s = currentWorkSession();
      if (!s) return false;
      s.openUser();
      return true;
    },
    close: function () {
      var s = currentWorkSession();
      if (s && s.isOn()) s.closeUser();
    },
    isOn: function () {
      var s = currentWorkSession();
      return !!(s && s.isOn());
    },
    refresh: function () {
      var s = currentWorkSession();
      if (s) s.refresh();
    },
    /** A ready "⤢ <label>" button that opens the mode. */
    button: function (label) {
      var p = currentProject();
      var def = p ? craftFor(p) : null;
      var spec = craftWorkSpec(def);
      var text = label || (spec && spec.label) || 'Working mode';
      var b = button('btn work-open', null, text + ': full screen');
      b.appendChild(el('span', 'work-open-glyph', (spec && spec.icon) || '⤢'));
      b.appendChild(el('span', 'work-open-label', text));
      on(b, 'click', function (e) {
        e.stopPropagation();
        workModeApi.open();
      });
      return b;
    }
  };
  ctx.workMode = workModeApi;

  function destroyCraftProject() {
    if (!activeCraft) return;
    var def = activeCraft.def;
    activeCraft = null;
    // wave K: hide the craft's working mode with its screen (the choice stays remembered)
    if (def && craftWork[def.id]) craftWork[def.id].sync(false);
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

  /**
   * The finish sheet, in both of its shapes.
   *
   * With nothing blocking it is the celebration. With parts still outstanding
   * (02 #2: a target-less part that was never touched blocks the project) it
   * names them and offers "Finish anyway", which is `finishProject(force)`.
   * @param {object} p
   * @param {string[]} [blocking] part names still in the way
   */
  function showProjectDoneSheet(p, blocking) {
    var left = Array.isArray(blocking) ? blocking : [];
    openSheet({
      subject: p.id,
      title: left.length ? 'Finish ' + p.name + '?' : 'All parts done! 🎉',
      build: function (body) {
        if (!left.length) {
          // wave H (knit-qa): knitting comes off the needles, not the hook
          body.appendChild(el('p', null, p.name + (p.craft === 'knitting' ? ' is off the needles.' : ' is off the hook.') + ' Time for assembly.'));
        } else {
          body.appendChild(
            el('p', null, 'These parts are not finished yet:')
          );
          var ul = el('ul', 'blocking-list');
          left.slice(0, 12).forEach(function (name) {
            ul.appendChild(el('li', null, name));
          });
          if (left.length > 12) ul.appendChild(el('li', 'muted', '…and ' + (left.length - 12) + ' more'));
          body.appendChild(ul);
          body.appendChild(
            el('p', 'muted', 'Finish anyway if you are done with them — nothing is deleted, and Undo puts it back.')
          );
          var anyway = button('btn primary block big', 'Finish anyway');
          on(anyway, 'click', function () {
            var res = Store.finishProject(p.id, { force: true });
            closeAllSheets();
            if (res && res.ok) {
              fb('done');
              celebrate('project');
              render();
              announce('Project complete');
              toast(p.name + ' is finished ✓', { ms: 3200 });
            }
          });
          body.appendChild(anyway);
        }
        var b = button('btn' + (left.length ? ' block' : ' primary block big'), 'Assembly checklist →');
        on(b, 'click', function () {
          closeAllSheets();
          openChecklistSheet(p.id);
        });
        body.appendChild(b);
      }
    });
  }

  /**
   * Wave G: every part of one size is done. The maker who wanted one bee is
   * finished; the one making the set goes on to the next size. Nothing is
   * removed either way, and Finish is undoable like everywhere else.
   */
  function showGroupDoneSheet(p, name) {
    var next = null;
    projectGroups(p).forEach(function (g) {
      if (next || g.name === name) return;
      var pr = Store.groupProgress(p.id, g.name);
      if (pr && !pr.done) next = g.name;
    });
    openSheet({
      subject: p.id,
      title: groupLabel(p, name) + ' done! 🎉',
      build: function (body, api) {
        // wave H (knit-qa): a knitting book's group is a pattern, off the needles
        var knitG = groupNoun(p) === 'pattern';
        body.appendChild(el('p', null, 'Every ' + name + ' part is off the ' + (knitG ? 'needles.' : 'hook.') +
          (next ? (knitG ? ' The other patterns are still in this project.' : ' The other sizes are still in this project.') : '')));
        var fin = button('btn primary block big', 'Finish the project');
        on(fin, 'click', function () {
          var res = Store.finishProject(p.id, { force: true });
          api.close();
          if (res && res.ok) {
            celebrate('project');
            render();
            announce('Project complete');
            toast(p.name + ' is finished ✓', {
              ms: 6000, actionText: 'Undo', onAction: function () { Store.undo(); render(); }
            });
          }
        });
        body.appendChild(fin);
        if (next) {
          var go = button('btn block', 'Go on to ' + next);
          on(go, 'click', function () {
            api.close();
            pickSizeTab(p, next, false);
          });
          body.appendChild(go);
        }
        var later = button('btn ghost block', 'Not now');
        on(later, 'click', function () { api.close(); });
        body.appendChild(later);
      }
    });
  }

  /** Once per part per session — the guard is a nudge, not a nag. */
  var alreadyDoneSaid = Object.create(null);

  function applyResult(res) {
    if (!res || res.event === 'none') return;
    var p = currentProject();
    if (!p) return;
    var prt = Store.activePart(p);
    // wave H: a short row is not a row
    if (knitBeforeResult(res, p, prt)) {
      if (els.btnUndo) els.btnUndo.disabled = !Store.canUndo();
      return;
    }

    switch (res.event) {
      // 13 #6: the part is already finished, so nothing moved. Say so once
      // and stop — the counter must not pretend to climb past its target.
      case 'alreadyDone':
        var key = String(res.partName || (prt && prt.id) || '');
        if (!alreadyDoneSaid[key]) {
          alreadyDoneSaid[key] = true;
          toast('Already finished — undo a row to keep counting', { ms: 3600 });
        }
        fb('undo');
        updateCounters(p, prt);
        break;

      case 'stitch':
        fb('tap');
        updateCounters(p, prt);
        pushDiagram('stitch');
        // Announcement policy (see announce): with grouping off there is no
        // group to mark, so every 50th stitch is the milestone.
        if (!(p.groupSize > 0) && res.stitch > 0 && res.stitch % 50 === 0) {
          announce('Stitch ' + res.stitch);
        }
        break;

      case 'group':
        fb('group');
        updateCounters(p, prt);
        pushDiagram('stitch');
        announce('Stitch ' + res.stitch + ', group ' + res.group + ' done');
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
        // "Round 5 done" — the piece's own word, and what the number means
        // (`row` counts COMPLETED rows; "Round 5" alone read as "on round 5").
        announce(rowWordAt(p, prt, prt.row) + ' ' + prt.row + ' done');
        // Wave F (02 #3): a colour change is a milestone too (the one
        // announcement policy) — said once, on the row it belongs to.
        var yc = null;
        try { yc = Store.rowColorInfo(prt, prt.row + 1); } catch (eY) { yc = null; }
        if (yc && yc.change) announce(yarnChangeText(yc.change, p, prt));
        // 12 #1: a finished row is the earliest honest moment to ask the
        // browser to keep this data. Once, after a real gesture.
        askForPersistOnce();
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

      case 'groupDone':
        // Wave G: one size of a multi-size booklet is finished. The project is
        // not - the other sizes are still in it - so ask: finish here, or go on.
        fb('done');
        celebrate('part');
        render();
        announce(res.group + ' size complete');
        showGroupDoneSheet(p, res.group);
        break;

      case 'projectDone':
        fb('done');
        // finishProject banks the timer and stamps finishedAt exactly once;
        // if something still blocks, the sheet offers "Finish anyway".
        var fin = Store.finishProject(p.id);
        celebrate('project');
        render();
        announce('Project complete');
        askForPersistOnce();
        showProjectDoneSheet(p, fin && fin.ok ? [] : (fin ? fin.blocking : []));
        break;

      default:
        updateCounters(p, prt);
        pushDiagram('none');
    }
    // wave H: the side of the next row, the other piece of a pair
    knitAfterResult(res, p);
    // The fast paths above skip updateBottomBar; a tap is undoable at once.
    if (els.btnUndo) els.btnUndo.disabled = !Store.canUndo();
  }

  /* ================================================================== *
   * 14b. Knitting on the counter (wave H, knit-counter; CONTRACT §3)
   *
   * Knitting renders #screen-project like crochet. Everything here is
   * knitting-only and built lazily (index.html is not this section's): the
   * RS/WS chip and cable ring in the row label, the short-row strip under
   * the row counter, the chart / length / partner chips under the pattern
   * line, the marker strip under the stitch readout, "+ marker" in the
   * stitch actions, the two-at-a-time tab, the part editor's Knitting card
   * (gauge, two at a time, markers) and the glossary sheet. A crochet
   * project never gets any of it: every entry point returns at isKnit().
   * ================================================================== */

  var KNIT_ID = 'knitting';
  var knitEls = { short: null, extra: null, markers: null, addMarker: null };
  var KNIT_HOLD_MS = 550;

  function isKnit(p) {
    return !!(p && p.craft === KNIT_ID && typeof Store.sideInfo === 'function');
  }

  function knitSideWord(s) {
    return s === 'rs' ? 'right side' : s === 'ws' ? 'wrong side' : '';
  }

  function knitNum(v) {
    if (v === null || v === undefined || v === '') return '';
    var n = Math.round(Number(v) * 100) / 100;
    return isFinite(n) ? String(n) : '';
  }

  function knitDecimalInput(value, placeholder, label) {
    var i = numInput(value == null ? '' : value, 0, 999, placeholder);
    i.inputMode = 'decimal';
    i.step = 'any';
    if (label) i.setAttribute('aria-label', label);
    return i;
  }

  /** Remove every knitting widget (a crochet project, or no part). */
  function hideKnitWidgets() {
    ['short', 'extra', 'markers', 'addMarker'].forEach(function (k) {
      if (knitEls[k]) knitEls[k].hidden = true;
    });
  }

  /** One widget, made once; the caller puts it in place while it has no parent. */
  function ensureKnitEl(key, cls) {
    var n = knitEls[key];
    if (n) return n;
    n = el(key === 'addMarker' ? 'button' : 'div', cls);
    if (key === 'addMarker') n.type = 'button';
    n.hidden = true;
    knitEls[key] = n;
    return n;
  }

  /** Called at the end of updateCounters: paint the knitting widgets. */
  function updateKnitWidgets(p, prt) {
    syncKnitTapHint(p, prt);   // wave K (P13): "Tap = 1 repeat (5 sts) · hold = 1 st", knitting only
    if (!isKnit(p) || !prt) { hideKnitWidgets(); return; }
    var finished = partFinished(prt);
    var sr = null, si = null, ci = null;
    try { sr = Store.shortRowInfo(prt); } catch (e) { sr = null; }
    try { si = Store.sideInfo(prt, p); } catch (e2) { si = null; }
    try { ci = Store.cableInfo(prt); } catch (e3) { ci = null; }
    var mate = Store.linkedPart(p, prt);

    /* ---- the row label: "Sleeve 1+2 · ROW · RS · cable in 3" ---- */
    if (mate && els.rowLabel) {
      var tag = el('span', 'row-group-tag knit-pair-tag', Store.linkedLabel(p, prt) + ' · ');
      els.rowLabel.insertBefore(tag, els.rowLabel.firstChild);
    }
    if (sr && els.rowLabel && !finished) {
      els.rowLabel.appendChild(el('span', 'knit-short-tag', ' · SHORT ROWS'));
    }
    if (si && !si.inRound && !finished && els.rowLabel) {
      var chip = button('knit-side-chip ' + (si.side || 'unknown') + (si.source === 'you' ? ' mine' : ''),
        si.side ? si.side.toUpperCase() : 'RS?');
      chip.setAttribute('data-tour', 'knit-side');
      var why = si.side
        ? knitSideWord(si.side) + (si.source === 'you' ? ' (set by you)' : si.source === 'parity' ? ' (counted from the pattern)' : ' (the pattern says so)')
        : 'side not known';
      chip.setAttribute('aria-label', 'This ' + (sr ? 'short row' : 'row') + ' is on the ' + why + '. Tap to switch sides');
      chip.title = why.charAt(0).toUpperCase() + why.slice(1) + ' — tap to switch';
      on(chip, 'click', function (e) {
        e.stopPropagation();
        var cur = currentProject();
        var cp = cur ? Store.activePart(cur) : null;
        if (!cur || !cp) return;
        var res = Store.flipSide(cur.id, cp.id);
        fb('tap');
        updateCounters(cur, Store.activePart(cur));
        updateBottomBar(cur, Store.activePart(cur));
        if (res && res.side) announce('Now on the ' + knitSideWord(res.side));
      });
      els.rowLabel.appendChild(document.createTextNode(' '));
      els.rowLabel.appendChild(chip);
    }
    if (ci && ci.inRows !== null && ci.inRows !== undefined && !finished && els.rowLabel) {
      var ring = el('span', 'knit-cable' + (ci.inRows === 0 ? ' now' : ''));
      var fill = ci.every ? Math.max(0, Math.min(1, 1 - ci.inRows / ci.every)) : 0;
      if (ci.inRows === 0) fill = 1;
      ring.style.setProperty('--knit-fill', String(Math.round(fill * 360)) + 'deg');
      ring.appendChild(el('span', 'knit-cable-ring'));
      ring.appendChild(el('span', 'knit-cable-text', ci.inRows === 0 ? 'cable row' : 'cable in ' + ci.inRows));
      ring.setAttribute('role', 'img');
      ring.setAttribute('aria-label', ci.inRows === 0
        ? 'Cable crossing on this row' + (ci.name ? ': ' + ci.name : '')
        : 'Cable crossing in ' + ci.inRows + ' ' + (ci.inRows === 1 ? 'row' : 'rows') + (ci.every ? ', every ' + ci.every : ''));
      els.rowLabel.appendChild(document.createTextNode(' '));
      els.rowLabel.appendChild(ring);
    }
    var plus = document.getElementById('row-plus');
    if (plus) plus.setAttribute('aria-label', sr ? 'Short row done (turn)' : 'Complete row');

    /* ---- short rows: "Short row 3 of 8" under the row counter ---- */
    var short = ensureKnitEl('short', 'knit-short');
    if (!short.parentNode) {
      var card0 = els.rowNumber ? els.rowNumber.closest('.counter-card') : null;
      if (card0 && card0.parentNode) card0.parentNode.insertBefore(short, card0.nextSibling);
    }
    if (short.parentNode) {
      clear(short);
      if (sr && !finished) {
        short.hidden = false;
        short.appendChild(el('span', 'knit-short-icon', '↩'));
        // (wave H, knit-qa-2: and how far it works, when the reader knows)
        var txt = 'Short row ' + sr.n + (sr.of ? ' of ' + sr.of : '') + (sr.worked ? ' · ' + sr.worked + ' sts' : '');
        short.appendChild(el('span', 'knit-short-text', txt));
        short.appendChild(el('span', 'knit-short-sub', sr.numbered
          ? 'rows ' + (sr.base + 1) + (sr.of ? '–' + (sr.base + sr.of) : '+') + ' · the row moves on after them'
          : 'not rows · ' + partRowWord(p, prt).toLowerCase() + ' stays at ' + prt.row));
        var end = button('linkish knit-short-end', 'Done', 'Done with short rows');
        on(end, 'click', function () {
          var cur = currentProject();
          var cp = cur ? Store.activePart(cur) : null;
          if (!cur || !cp) return;
          var r = Store.endShortRows(cur.id, cp.id);
          fb('row');
          render();
          if (r && r.event !== 'none') {
            announce('Short rows done' + (r.shortRowsDone ? ', ' + partRowWord(cur, cp).toLowerCase() + ' ' + Store.activePart(cur).row + ' done' : ''));
          }
        });
        short.appendChild(end);
        short.setAttribute('role', 'status');
        // the line the short row is worked from, in the pattern line
        if (sr.line && sr.line.text && els.patternLine) {
          els.patternLine.hidden = false;
          els.patternTag.textContent = 'Short row ' + sr.n;
          fillSizeMarked(els.patternText, sr.line.text, prt, p);
          if (els.patternNotes) els.patternNotes.hidden = true;
        }
      } else {
        short.hidden = true;
      }
    }

    /* ---- under the pattern line: chart · length · the other piece ---- */
    var extra = ensureKnitEl('extra', 'knit-extra');
    if (!extra.parentNode && els.patternLine && els.patternLine.parentNode) {
      els.patternLine.parentNode.insertBefore(extra, els.patternLine.nextSibling);
    }
    if (extra.parentNode) {
      clear(extra);
      var any = false;
      var chi = null, ui = null;
      try { chi = finished ? null : Store.chartInfo(prt); } catch (e4) { chi = null; }
      try { ui = finished || sr ? null : Store.untilInfo(prt); } catch (e5) { ui = null; }
      if (chi) {
        var cb = button('knit-chip knit-chart-chip', '▦ ' + chi.name + (chi.row ? ' · row ' + chi.row + (chi.of ? ' of ' + chi.of : '') : ''));
        cb.setAttribute('aria-label', chi.name + ', chart row ' + (chi.row || 'unknown') + (chi.of ? ' of ' + chi.of : '') + '. Open the chart');
        on(cb, 'click', function () { openKnitChartSheet(p.id, prt.id); });
        extra.appendChild(cb);
        any = true;
      }
      if (ui) {
        var ub = button('knit-chip knit-until-chip', untilChipText(ui, p, prt));
        ub.setAttribute('aria-label', untilSentence(ui, p, prt) + ' Open the gauge');
        on(ub, 'click', function () { openPartEditor(p.id, prt.id); });
        extra.appendChild(ub);
        any = true;
      }
      if (mate) {
        var mb = button('knit-chip knit-mate-chip', '⇄ ' + mate.name + ' · ' + partShortRowWord(p, mate) + ' ' + (mate.row + 1));
        mb.setAttribute('aria-label', 'Worked two at a time with ' + mate.name + ', on ' +
          partRowWord(p, mate).toLowerCase() + ' ' + (mate.row + 1) + '. Switch to it');
        on(mb, 'click', function () {
          Store.setActivePart(p.id, mate.id);
          fb('tap');
          render();
          announce(mate.name);
        });
        extra.appendChild(mb);
        any = true;
      }
      extra.hidden = !any;
    }

    /* ---- the marker strip under the stitch readout ---- */
    var strip = ensureKnitEl('markers', 'knit-markers');
    if (!strip.parentNode && els.stitchReadout && els.stitchReadout.parentNode) {
      els.stitchReadout.parentNode.insertBefore(strip, els.stitchReadout.nextSibling);
    }
    if (strip.parentNode) paintMarkers(strip, p, prt, finished);

    /* ---- "+ marker" in the stitch actions ---- */
    var add = ensureKnitEl('addMarker', 'btn ghost knit-add-marker');
    if (!add.parentNode && els.stitchActions) {
      add.textContent = '+ marker';
      var resetBtn = document.getElementById('stitch-reset');
      if (resetBtn && resetBtn.parentNode === els.stitchActions) els.stitchActions.insertBefore(add, resetBtn);
      else els.stitchActions.appendChild(add);
      on(add, 'click', function () {
        var cur = currentProject();
        var cp = cur ? Store.activePart(cur) : null;
        if (!cur || !cp) return;
        var m = Store.addMarker(cur.id, cp.id, {});
        if (!m) { toast('That marker could not be placed'); return; }
        fb('tap');
        updateCounters(cur, Store.activePart(cur));
        updateBottomBar(cur, Store.activePart(cur));
        announce('Marker placed after stitch ' + m.at);
        toast('Marker placed after stitch ' + m.at, { actionText: 'Undo', onAction: function () { Store.undo(); render(); } });
      });
    }
    if (add) {
      add.hidden = finished;
      add.setAttribute('aria-label', 'Place a marker after stitch ' + prt.stitch);
    }

    // wave K (knit-ui): stretch, resolved repeat, panels, chart strip, colours, shaping
    var kdef = craftDefs[KNIT_ID];
    if (kdef && typeof kdef.counterPaint === 'function') {
      try {
        kdef.counterPaint(p, prt, { extra: knitEls.extra, patternLine: els.patternLine, patternTag: els.patternTag,
          patternText: els.patternText, patternNotes: els.patternNotes, rowLabel: els.rowLabel, finished: finished, hook: true });
      } catch (eK) { /* the counter stays as it was */ }
    }
  }

  /** "rows" / "rounds" for a part (wave K, E13: a part worked in the round counts rounds). */
  function unitWords(p, prt, n) {
    var w = partRowWord(p, prt).toLowerCase();
    return n === 1 ? w : w + 's';
  }

  function untilChipText(ui, p, prt) {
    var len = ui.kind === 'length' ? knitNum(ui.value) + ' ' + (ui.unit || '') : null;
    if (ui.kind === 'rows') return '↕ ' + ui.rows + ' ' + unitWords(p, prt, ui.rows);
    if (!ui.rows) return '📏 ' + len + ' · add your gauge';
    var s = '📏 ' + len + ' ≈ ' + ui.rows + ' ' + unitWords(p, prt, ui.rows);
    if (ui.gaugeSource === 'swatch' && ui.patternRows && ui.patternRows !== ui.rows) s += ', not ' + ui.patternRows;
    if (ui.targetRow) s += ' · ≈ ' + (prt ? partRowWord(p, prt) : rowWord(p)).toLowerCase() + ' ' + ui.targetRow;
    return s;
  }

  function untilSentence(ui, p, prt) {
    if (ui.kind === 'rows') return 'Work ' + ui.rows + ' ' + unitWords(p, prt, ui.rows) + '.';
    var len = knitNum(ui.value) + ' ' + (ui.unit || '');
    if (!ui.rows) return 'Work until it measures ' + len + '. Add the gauge to turn this into ' + unitWords(p, prt, 2) + '.';
    var s = len + ' is about ' + ui.rows + ' ' + unitWords(p, prt, ui.rows) + ' at ' +
      (ui.gaugeSource === 'swatch' ? 'your measured gauge' : 'the pattern’s gauge');
    if (ui.gaugeSource === 'swatch' && ui.patternRows && ui.patternRows !== ui.rows) s += ' (' + ui.patternRows + ' at the pattern’s)';
    s += '.';
    if (ui.targetRow) {
      s += ' Counted from ' + (ui.fromRow ? partRowWord(p, prt).toLowerCase() + ' ' + ui.fromRow : 'the start') +
        ', that is about ' + partRowWord(p, prt).toLowerCase() + ' ' + ui.targetRow +
        (ui.endOn ? ', a ' + knitSideWord(ui.endOn) + ' row' : '') + '.';
    }
    return s + ' Measure to be sure.';
  }

  /* ---- markers ---- */

  function paintMarkers(strip, p, prt, finished) {
    var mi = null;
    try { mi = Store.markerInfo(prt); } catch (e) { mi = null; }
    clear(strip);
    strip.setAttribute('data-tour', 'knit-markers');
    if (!mi || !mi.markers.length || finished) { strip.hidden = true; return; }
    strip.hidden = false;
    var row = el('div', 'knit-marker-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Stitch markers' + (mi.source === 'pattern' ? ' from the pattern' : ''));
    var nextId = mi.next && mi.next.marker ? mi.next.marker.id : null;
    mi.markers.forEach(function (m) {
      var bor = m.name === 'BOR';
      var label = bor ? '▲ BOR' : '● ' + (m.name || m.at);
      var b = button('knit-marker' + (m.id === nextId ? ' next' : '') + (mi.atMarker && mi.atMarker.id === m.id ? ' here' : ''), label);
      b.setAttribute('aria-label', (bor ? 'Beginning of round marker' : 'Marker ' + (m.name || '') + ' after stitch ' + m.at) +
        '. Tap to rename, hold (or press Delete) to remove');
      bindMarkerPress(b, p, prt, m);
      row.appendChild(b);
    });
    strip.appendChild(row);
    var say = '';
    if (mi.shifted) {
      say = 'Markers set on a ' + mi.basis + '-st row · this row makes ' + mi.total;
    } else if (mi.atMarker) {
      say = 'Slip marker' + (mi.atMarker.name ? ' ' + mi.atMarker.name : '') + (mi.next ? ' · ' + mi.next.in + ' → ' + (mi.next.end ? 'end' : 'next') : '');
    } else if (mi.next) {
      say = mi.next.in + ' → ' + (mi.next.end ? 'end' : (mi.next.marker.name && mi.next.marker.name !== 'BOR' ? mi.next.marker.name : 'marker'));
    }
    // one line under the chips: "10 → m2 · 3 | 12 | 30 | 12 | 3"
    var info = el('div', 'knit-marker-info');
    if (say) info.appendChild(el('span', 'knit-marker-next', say));
    strip.appendChild(info);
    if (mi.segments && mi.segments.length > 1) {
      if (say) info.appendChild(el('span', 'knit-seg-dot', ' · '));
      var segs = el('span', 'knit-segments');
      segs.setAttribute('aria-label', 'Stitches between markers: ' + mi.segments.map(function (n) { return n === null ? 'unknown' : n; }).join(', '));
      mi.segments.forEach(function (n, i) {
        if (i) segs.appendChild(el('span', 'knit-seg-bar', '|'));
        segs.appendChild(el('span', 'knit-seg' + (i === mi.segIndex ? ' on' : ''), n === null ? '…' : String(n)));
      });
      info.appendChild(segs);
    }
    if (!info.firstChild) strip.removeChild(info);
  }

  function bindMarkerPress(b, p, prt, m) {
    var timer = null, held = false;
    function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
    on(b, 'pointerdown', function () {
      held = false;
      cancel();
      timer = setTimeout(function () {
        timer = null;
        held = true;
        removeMarkerNow(p.id, prt.id, m);
      }, KNIT_HOLD_MS);
    });
    on(b, 'pointerup', cancel);
    on(b, 'pointerleave', cancel);
    on(b, 'pointercancel', cancel);
    on(b, 'contextmenu', function (e) { e.preventDefault(); });
    on(b, 'click', function () {
      if (held) { held = false; return; }
      openMarkerSheet(p.id, prt.id, m);
    });
    on(b, 'keydown', function (e) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeMarkerNow(p.id, prt.id, m); }
    });
  }

  function removeMarkerNow(projectId, partId, m) {
    if (!Store.removeMarker(projectId, partId, m.id)) return;
    fb('undo');
    render();
    var what = m.name === 'BOR' ? 'Beginning-of-round marker' : 'Marker' + (m.name ? ' ' + m.name : '');
    announce(what + ' removed');
    toast(what + ' removed', { actionText: 'Undo', onAction: function () { Store.undo(); render(); } });
  }

  function openMarkerSheet(projectId, partId, m) {
    var input;
    openSheet({
      subject: projectId,
      title: m.name === 'BOR' ? 'Beginning of round' : 'Marker after stitch ' + m.at,
      build: function (body) {
        input = textInput(m.name || '', 'heel, raglan, BOR…');
        input.maxLength = 24;
        body.appendChild(field('Name', input, 'Call it BOR for the beginning of the round. Hold a marker on the counter to remove it.'));
      },
      footer: [
        {
          text: 'Remove', cls: 'btn danger', onClick: function (api) {
            api.close();
            removeMarkerNow(projectId, partId, m);
          }
        },
        {
          text: 'Save', cls: 'btn primary', onClick: function (api) {
            var res = Store.renameMarker(projectId, partId, m.id, input.value);
            if (!res) { toast(/^\s*bor\s*$/i.test(input.value) ? 'There is already a BOR marker' : 'That name could not be saved'); return; }
            api.close();
            render();
          }
        }
      ]
    });
  }

  /* ---- two at a time: one tab for the pair ---- */

  /**
   * Called from renderTabs for every part. A linked pair is painted once,
   * as one tab "Sleeve 1 | +2" (each half picks its piece), at the place of
   * its first part; returns true when the part was handled here.
   */
  function knitPairTab(p, prt, openSize) {
    if (!isKnit(p)) return false;
    var mate = Store.linkedPart(p, prt);
    if (!mate) return false;
    if (openSize && mate.group && mate.group !== openSize) return false;
    var first = p.parts.indexOf(prt) < p.parts.indexOf(mate) ? prt : mate;
    if (first !== prt) return true;          // painted with its partner
    var second = mate;
    var label = Store.linkedLabel(p, prt);
    var wrap = el('div', 'tab-pair');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', label + ', worked two at a time');
    [first, second].forEach(function (q, i) {
      var isActive = q.id === p.activePartId;
      var text = i === 0 ? q.name : (label.indexOf(first.name) === 0 && label.length > first.name.length
        ? label.slice(first.name.length) : '+' + q.name);
      var tab = button('tab tab-half' + (isActive ? ' active' : ''));
      tab.setAttribute('data-focus-key', 'part-tab:' + q.id);
      tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      tab.setAttribute('aria-label', q.name + (isActive ? ' (current part — tap to edit)' : ''));
      tab.title = q.name;
      tab.appendChild(el('span', 'tab-name', text));
      if (q.makeCount > 1) {
        tab.appendChild(document.createTextNode(' '));
        tab.appendChild(el('span', 'tab-badge', q.piecesDone + '/' + q.makeCount));
      }
      if (q.piecesDone >= q.makeCount && q.targetRows) tab.appendChild(document.createTextNode(' ✓'));
      on(tab, 'click', function () {
        if (isActive) openPartEditor(p.id, q.id);
        else { Store.setActivePart(p.id, q.id); render(); }
      });
      wrap.appendChild(tab);
    });
    els.tabs.appendChild(wrap);
    return true;
  }

  /* ---- results the counter gets back ---- */

  /** Before applyResult's switch: the short-row events. True = handled. */
  function knitBeforeResult(res, p, prt) {
    if (!res || !isKnit(p)) return false;
    if (res.event === 'shortRow') {
      fb('row');
      render();
      var si = Store.sideInfo(Store.activePart(p), p);
      announce('Short row ' + res.n + (res.of ? ' of ' + res.of : '') + (si && si.side ? ', ' + knitSideWord(si.side) : ''));
      knitLinkedSay(res);
      return true;
    }
    if (res.event === 'shortRowsDone') {
      fb('row');
      render();
      announce('Short rows done. Back to ' + partRowWord(p, prt).toLowerCase() + ' ' + (Store.activePart(p).row + 1));
      knitLinkedSay(res);
      return true;
    }
    return false;
  }

  function knitLinkedSay(res) {
    if (res && res.linked && res.linked.event && res.linked.event !== 'none' && res.linked.event !== 'alreadyDone') {
      announce(res.linked.partName + ' too');
    }
  }

  /** After applyResult's switch: the side of the next row, the other piece. */
  function knitAfterResult(res, p) {
    if (!res || !isKnit(p)) return;
    var prt = Store.activePart(p);
    if (res.event === 'row' || res.event === 'rowAuto') {
      if (res.shortRowsDone) announce('Short rows done');
      var si = null;
      try { si = prt ? Store.sideInfo(prt, p) : null; } catch (e) { si = null; }
      if (si && si.side && !si.inRound) announce('Next: ' + knitSideWord(si.side));
    }
    knitLinkedSay(res);
    if (res.switchedTo) {
      render();
      announce(res.switchedTo.partName + ' next');
      toast(res.switchedTo.partName + ' next', { ms: 2200 });
    } else if (res.linked) {
      renderTabs(p);
    }
  }

  /** The row-minus announcement in short rows ("Back to short row 3"). */
  function knitBackText(p, prt, res) {
    if (!isKnit(p) || !res) return '';
    if (res.event === 'shortRow') return 'Back to short row ' + res.n + (res.of ? ' of ' + res.of : '');
    return '';
  }

  /* ---- the part editor's Knitting card ---- */

  /**
   * Gauge (the project's, printed vs measured, and what that does to this
   * part's "until it measures" lines), two at a time, markers. The gauge is
   * saved with the part's Save, in the same Undo; the pair and marker
   * buttons act at once (each one Undo, with a toast).
   * @returns {{node:Element, commit:Function}|null}
   */
  function knitEditorCard(p, prt, api, patternArea) {
    if (!isKnit(p)) return null;
    var g = Store.gaugeOf(p) || {};
    var card = el('div', 'knit-card');
    card.appendChild(el('div', 'knit-card-title', '🧣 Knitting'));

    /* gauge */
    var unit = g.unit === 'in' ? 'in' : 'cm';
    var sts = knitDecimalInput(knitNum(g.sts), '22', 'Pattern stitches');
    var rows = knitDecimalInput(knitNum(g.rows), '30', 'Pattern rows');
    var over = knitDecimalInput(knitNum(g.over), unit === 'in' ? '4' : '10', 'Over');
    var mySts = knitDecimalInput(knitNum(g.swatch && g.swatch.sts), '', 'Your stitches');
    var myRows = knitDecimalInput(knitNum(g.swatch && g.swatch.rows), '', 'Your rows');
    var needle = textInput(g.needle || '', '4 mm');
    var unitSeg = segmented([{ id: 'cm', label: 'cm' }, { id: 'in', label: 'in' }], unit, function (u) {
      if (!over.value || over.value === (u === 'in' ? '10' : '4')) over.value = u === 'in' ? '4' : '10';
      syncGauge();
    });
    unitSeg.node.setAttribute('aria-label', 'Gauge measured in');

    var pRow = el('div', 'row-flex knit-gauge-row');
    pRow.appendChild(field('Sts', sts));
    pRow.appendChild(field('Rows', rows));
    pRow.appendChild(field('Over', over));
    var gWrap = el('div', 'field');
    gWrap.appendChild(el('div', 'field-label', 'Pattern gauge (whole project)'));
    gWrap.appendChild(pRow);
    gWrap.appendChild(unitSeg.node);
    card.appendChild(gWrap);
    var mRow = el('div', 'row-flex knit-gauge-row');
    mRow.appendChild(field('Your sts', mySts));
    mRow.appendChild(field('Your rows', myRows));
    var mWrap = el('div', 'field');
    mWrap.appendChild(el('div', 'field-label', 'Your swatch, over the same'));
    mWrap.appendChild(mRow);
    card.appendChild(mWrap);
    card.appendChild(field('Needle', needle));
    var result = el('div', 'knit-gauge-result');
    result.setAttribute('aria-live', 'polite');
    card.appendChild(result);

    function draftGauge() {
      return {
        sts: sts.value, rows: rows.value, over: over.value, unit: unitSeg.get(), needle: needle.value,
        swatch: { sts: mySts.value, rows: myRows.value }
      };
    }

    function syncGauge() {
      clear(result);
      var d = Store.normalizeGauge(draftGauge());
      if (!d) return;
      var bits = [];
      if (d.rows && d.swatch.rows) {
        var pct = Math.round((d.swatch.rows / d.rows - 1) * 100);
        bits.push('Rows: ' + (pct === 0 ? 'on gauge' : Math.abs(pct) + '% ' + (pct > 0 ? 'tight (shorter rows)' : 'loose (taller rows)')));
      }
      if (d.sts && d.swatch.sts) {
        var spct = Math.round((d.swatch.sts / d.sts - 1) * 100);
        bits.push('Stitches: ' + (spct === 0 ? 'on gauge' : Math.abs(spct) + '% ' + (spct > 0 ? 'tight' : 'loose')));
      }
      if (bits.length) result.appendChild(el('div', 'field-hint', bits.join(' · ')));
      // this part's "until it measures" lines, through the gauge in the boxes
      var lines = [];
      try {
        var pa = typeof patternArea === 'function' ? patternArea() : patternArea;
        var probe = { id: prt.id + ':knitprobe', patternText: pa ? pa.value : prt.patternText, sizeIndex: prt.sizeIndex || 0, craft: KNIT_ID };
        lines = Store.linesFor(probe) || [];
      } catch (e) { lines = []; }
      var shown = 0;
      lines.forEach(function (l) {
        if (shown >= 4 || !l || !l.until || l.until.kind !== 'length' || !(l.until.value > 0)) return;
        shown++;
        var mine = Store.lengthToRows(d, l.until.value, l.until.unit, 'swatch');
        var theirs = Store.lengthToRows(d, l.until.value, l.until.unit, 'pattern');
        var len = knitNum(l.until.value) + ' ' + (l.until.unit || d.unit);
        var say = !mine && !theirs ? len + ': add a row gauge to count it in rows'
          : len + ' ≈ ' + (mine || theirs) + ' rows' + (mine && theirs && mine !== theirs ? ', not ' + theirs : '') +
            (mine ? '' : ' (pattern gauge)');
        var item = el('div', 'knit-until-item');
        item.appendChild(el('span', 'knit-until-say', say));
        item.appendChild(el('span', 'knit-until-line', '“' + String(l.text).slice(0, 90) + (String(l.text).length > 90 ? '…' : '') + '”'));
        result.appendChild(item);
      });
      if (shown) result.appendChild(el('div', 'field-hint', 'An estimate for the counter (≈), never a set target: measure to be sure.'));
    }
    [sts, rows, over, mySts, myRows].forEach(function (i) { on(i, 'input', syncGauge); });
    syncGauge();

    /* two at a time */
    var mate = Store.linkedPart(p, prt);
    var pairWrap = el('div', 'field');
    pairWrap.appendChild(el('div', 'field-label', 'Two at a time'));
    if (mate) {
      pairWrap.appendChild(el('div', 'field-hint', 'Worked with ' + mate.name + ': one row tap moves both (' + Store.linkedLabel(p, prt) + ').'));
      var unl = button('btn block', 'Stop working them together');
      on(unl, 'click', function () {
        Store.unlinkPart(p.id, prt.id);
        api.close();
        render();
        toast('Unlinked', { actionText: 'Undo', onAction: function () { Store.undo(); render(); } });
      });
      pairWrap.appendChild(unl);
    } else {
      var others = p.parts.filter(function (q) { return q.id !== prt.id && (!prt.group || !q.group || q.group === prt.group); });
      if (prt.makeCount === 2 && prt.piecesDone === 0) {
        var split = button('btn block', 'Knit both at once (' + prt.name.replace(/([^s])s$/i, '$1') + ' 1+2)');
        on(split, 'click', function () {
          var res = Store.splitTwoAtATime(p.id, prt.id);
          if (!res) return;
          api.close();
          render();
          toast(Store.linkedLabel(p.id, res.a) + ': one row tap moves both', { actionText: 'Undo', onAction: function () { Store.undo(); render(); } });
        });
        pairWrap.appendChild(split);
      }
      if (others.length) {
        var sel = document.createElement('select');
        sel.setAttribute('aria-label', 'Work two at a time with');
        var none = document.createElement('option');
        none.value = '';
        none.textContent = 'Work with…';
        sel.appendChild(none);
        others.forEach(function (q) {
          var o = document.createElement('option');
          o.value = q.id;
          o.textContent = q.name;
          sel.appendChild(o);
        });
        on(sel, 'change', function () {
          if (!sel.value) return;
          var other = Store.part(p, sel.value);
          if (!Store.linkParts(p.id, prt.id, sel.value)) return;
          api.close();
          render();
          toast(prt.name + ' and ' + (other ? other.name : 'that part') + ' together', { actionText: 'Undo', onAction: function () { Store.undo(); render(); } });
        });
        pairWrap.appendChild(sel);
      }
      if (!others.length && !(prt.makeCount === 2 && prt.piecesDone === 0)) {
        pairWrap.appendChild(el('div', 'field-hint', 'Set How many to 2, or add a second part, to work two at a time.'));
      }
    }
    card.appendChild(pairWrap);

    /* markers */
    var mi = Store.markerInfo(prt);
    if (mi.source === 'part') {
      var mWrap2 = el('div', 'field');
      mWrap2.appendChild(el('div', 'field-label', 'Markers'));
      mWrap2.appendChild(el('div', 'field-hint', mi.markers.length + ' marker' + (mi.markers.length === 1 ? '' : 's') + ' placed by you.'));
      var clr = button('btn block', 'Clear my markers');
      on(clr, 'click', function () {
        Store.setMarkers(p.id, prt.id, []);
        api.close();
        render();
        toast('Markers cleared', { actionText: 'Undo', onAction: function () { Store.undo(); render(); } });
      });
      mWrap2.appendChild(clr);
      card.appendChild(mWrap2);
    }

    return {
      node: card,
      /** Inside the part's Save (after updatePart snapshotted): one Undo for both. */
      commit: function () {
        var d = Store.normalizeGauge(draftGauge());
        var cur = Store.gaugeOf(p.id);
        if (!d || JSON.stringify(d) === JSON.stringify(cur)) return;
        Store.setGauge(p.id, d, { undo: false });
      }
    };
  }

  /* ---- the glossary sheet (⋯ → Glossary) ---- */

  function openGlossarySheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var list = [];
    try { list = Store.glossary(p) || []; } catch (e) { list = []; }
    openSheet({
      subject: projectId,
      title: 'Glossary',
      build: function (body) {
        var search = textInput('', 'Find k2tog, ssk, w&t…');
        search.type = 'search';
        search.setAttribute('aria-label', 'Find an abbreviation');
        body.appendChild(search);
        var host = el('div', 'knit-glossary');
        body.appendChild(host);
        function row(g) {
          var r = el('div', 'knit-gloss-row');
          r.appendChild(el('span', 'knit-gloss-abbr', g.abbr));
          r.appendChild(el('span', 'knit-gloss-meaning', g.meaning));
          if (g.fromPattern) r.appendChild(el('span', 'knit-gloss-src', 'this pattern'));
          return r;
        }
        function paint() {
          clear(host);
          var q = search.value.trim().toLowerCase();
          var hits = list.filter(function (g) {
            return !q || g.abbr.toLowerCase().indexOf(q) >= 0 || g.meaning.toLowerCase().indexOf(q) >= 0;
          });
          var used = hits.filter(function (g) { return g.used || g.fromPattern; });
          var rest = hits.filter(function (g) { return !(g.used || g.fromPattern); });
          if (used.length) {
            host.appendChild(el('div', 'parts-group-head', 'In this pattern'));
            used.forEach(function (g) { host.appendChild(row(g)); });
          }
          if (rest.length) {
            if (q || !used.length) {
              host.appendChild(el('div', 'parts-group-head', used.length ? 'Other abbreviations' : 'Knitting abbreviations'));
              rest.forEach(function (g) { host.appendChild(row(g)); });
            } else {
              var more = document.createElement('details');
              more.className = 'knit-gloss-more';
              var sum = document.createElement('summary');
              sum.textContent = 'Other abbreviations (' + rest.length + ')';
              more.appendChild(sum);
              rest.forEach(function (g) { more.appendChild(row(g)); });
              host.appendChild(more);
            }
          }
          if (!hits.length) host.appendChild(el('div', 'field-hint', 'Nothing called that. Try the first letters (“ss”).'));
        }
        on(search, 'input', paint);
        paint();
      }
    });
  }

  /* ---- chart pages, kept at import ---- *
   * A knitting PDF read in a drop zone is also scanned by KnitChart (once,
   * on the open handle) and each chart page is drawn to a JPEG. When the
   * import then lands in a project, the images go to BlobStore
   * ('p:<id>:chartpage:<n>', as sewing keeps diagrams) and the charts to
   * `craftData.charts` / `chartPages`, so the counter never opens the PDF
   * again. Crochet and every other craft never get an onPages handler.
   */

  var KNIT_CHART_PAGES_MAX = 12;
  var KNIT_CAPTURE_MS = 30 * 60 * 1000;
  var knitCapture = null;
  var KNIT_CHART_KEYS = ['name', 'source', 'image', 'drawn', 'cols', 'rows', 'cells', 'spans', 'legend', 'noStitch',
    'readRS', 'startRow', 'rowStep', 'rowNos', 'labelSide', 'repeatBox', 'repeats', 'unknown', 'bbox', 'pageBox',
    'turned', 'pitch', 'legendFromPage',
    // wave K (knit-charts): a chart read from a PICTURE, with how sure the reader is
    'kind', 'confidence', 'reasons', 'calib', 'colour', 'imageBox', 'rowNosRead'];

  /** A drop zone's options with `onPages` present only while the craft is knitting. */
  function knitZoneOpts(opts, craftOf) {
    try {
      Object.defineProperty(opts, 'onPages', {
        configurable: true,
        enumerable: true,
        get: function () {
          var c = typeof craftOf === 'function' ? craftOf() : craftOf;
          var KC = window.KnitChart;
          return c === KNIT_ID && KC && typeof KC.scan === 'function' ? knitCaptureCharts : undefined;
        }
      });
    } catch (e) { /* an old engine: no chart pages, the text still reads */ }
    return opts;
  }

  function slimChart(c) {
    var o = {};
    KNIT_CHART_KEYS.forEach(function (k) { if (c && c[k] !== undefined) o[k] = c[k]; });
    try { return JSON.parse(JSON.stringify(o)); } catch (e) { return { name: c && c.name, rows: c && c.rows, cols: c && c.cols }; }
  }

  /** onPages for a knitting drop zone: remember the open handle; nothing is read yet. */
  function knitCaptureCharts(handle) {
    knitCapture = { at: Date.now(), handle: handle };
  }

  // page images for charts: 2 px per PDF point, so `chart.bbox` (points)
  // maps straight onto the picture for the crop
  var KNIT_CHART_SCALE = 2;

  /**
   * After an import into a knitting project: read its PDF's charts once, in
   * the background (KnitChart.scan, 2-4 s), draw each chart page, and keep
   * both with the project. The import itself never waits for this.
   */
  /**
   * wave H (knit-qa): the imported text of a project made from a pattern
   * BOOK (its parts carry a `group`), else null (one pattern: every chart in
   * the PDF is its own).
   */
  function knitImportedText(projectId) {
    var p = Store.project(projectId);
    if (!p || !p.parts.some(function (q) { return !!q.group; })) return null;
    return p.parts.map(function (q) { return String(q.patternText || '') + '\n' + String(q.placementNotes || ''); }).join('\n');
  }

  /** Does `text` name the chart: "Back and Sleeve Lace", "Chart B" / "B chart"? */
  function knitChartMentioned(name, text) {
    var n = String(name || '').replace(/,?\s*sizes?\b[\s\S]*$/i, '').replace(/\s+/g, ' ').trim();
    if (!n) return false;
    var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var t = String(text || '');
    var m = /^chart\s+([a-z0-9]+)$/i.exec(n);
    // "Chart B", and a one-word name ("Lace", "Foot"): only next to "chart"
    var one = m ? m[1] : (n.indexOf(' ') < 0 ? n : null);
    if (one) return new RegExp('\\bchart\\s+' + esc(one) + '\\b|\\b' + esc(one) + '\\s+chart\\b', 'i').test(t);
    return new RegExp('\\b' + esc(n).replace(/ /g, '\\s+') + '\\b', 'i').test(t);
  }

  /**
   * Wave K (knit-ui P20): a knitting pattern's materials (yarn for each size,
   * needles) live in its front matter, which the parts do not carry; keep
   * them with the project at import, as view state (no undo step). In a book,
   * the picked pattern's own (`bookPatterns()[i].materials`). Knitting only.
   * @returns {boolean} whether something was kept
   */
  function knitKeepMaterials(projectId, fullText, bookName) {
    var p = Store.project(projectId);
    var K = window.Knits;
    if (!isKnit(p) || !K || typeof Store.updateCraftData !== 'function' || !fullText) return false;
    var mat = null;
    try {
      if (bookName && typeof K.bookPatterns === 'function') {
        var list = K.bookPatterns(fullText) || [];
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === bookName) { mat = list[i].materials || null; break; }
      } else if (typeof K.materials === 'function') {
        mat = K.materials(fullText);
      }
    } catch (e) { mat = null; }
    if (!mat || !((mat.yarn && mat.yarn.length) || (mat.needles && mat.needles.length))) return false;
    Store.updateCraftData(projectId, function (cd) { cd.materials = mat; }, { undo: false });
    return true;
  }

  /**
   * Wave K (xs-audit): a PDF with no text layer is usually NOT a scan of
   * paper — most are born-digital files whose pages are pictures. Say what
   * is true and useful, and point at the opt-in text reader when this
   * browser can run it. Other errors keep their own message.
   */
  var NO_TEXT_RE = /scanned images|no text to read|has no text/i;
  function noTextMessage() {
    var reader = !!(window.Ocr && typeof window.Ocr.available === 'function' && window.Ocr.available());
    return 'These pages are pictures, so there is no text to read.' +
      (reader ? ' The text reader (Settings → Read scanned pages) can try them; check what it reads.' : '');
  }
  function pdfFailText(err) {
    var m = err && err.message ? String(err.message) : '';
    if (!m || NO_TEXT_RE.test(m)) return noTextMessage();
    return m;
  }

  /** Wave K (E12): is this chart page inside the imported book pattern's own pages? */
  function knitPageInside(page, within) {
    if (!within || !(within.from >= 1)) return true;
    return page >= within.from && page <= (within.to || within.from);
  }

  /**
   * Wave K (knit-audit 4): a knitting import's project name — the pattern's
   * own title (`Knits.title`, null when it is not sure), else the file name
   * tidied: no extension, no "knit-" style prefix, words spaced and
   * capitalised ("knit-patons-boyfriend-cable.pdf" → "Patons Boyfriend Cable").
   */
  function knitProjectName(text, fileBase) {
    var K = window.Knits;
    if (K && typeof K.title === 'function') {
      try { var t = K.title(text); if (t && String(t).trim()) return String(t).trim(); } catch (e) { /* the file name */ }
    }
    var b = String(fileBase || '').replace(/\.(pdf|txt|oxs|xml)$/i, '')
      .replace(/^(?:knit(?:ting)?|crochet|xs|sew(?:ing)?)[-_ ]+/i, '')
      .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!b) return '';
    return b.replace(/(^|\s)([a-z])/g, function (m, s, c) { return s + c.toUpperCase(); });
  }

  /** Wave K: the background chart scan in flight; a newer import (or ctx) cancels it. */
  var knitScanSignal = null;

  function cancelKnitScan() {
    if (knitScanSignal) { knitScanSignal.cancelled = true; knitScanSignal.aborted = true; }
    knitScanSignal = null;
  }

  /**
   * After a knitting import: read the PDF's charts in the background (never
   * awaited by the import). Wave K (knit-charts): pictures of charts are read
   * too (`pictures: true`, about 0.3–1 s a picture page, text pages cheap);
   * the scan starts after the import has painted and is cancelled by the
   * next import. A text-only import (no PDF read) returns at once.
   * @returns {boolean} whether a scan was started
   */
  function knitAttachCharts(projectId, within) {
    var cap = knitCapture;
    knitCapture = null;
    var p = Store.project(projectId);
    var KC = window.KnitChart;
    if (!cap || !cap.handle || !isKnit(p) || Date.now() - cap.at > KNIT_CAPTURE_MS ||
        typeof Store.setChartPages !== 'function' || !KC || typeof KC.scan !== 'function') return false;
    var handle = cap.handle;
    var found = [], blobs = {};
    cancelKnitScan();
    var sig = knitScanSignal = { cancelled: false, aborted: false };
    new Promise(function (res) {
      // off the import's critical path: after the toast and the new screen have painted
      window.setTimeout(res, 50);
    }).then(function () {
      if (sig.cancelled) throw { name: 'AbortError' };
      return KC.scan(handle, { signal: sig, pictures: true });
    }).then(function (pages) {
      if (sig.cancelled) return Promise.reject({ name: 'AbortError' });
      var work = Promise.resolve(), drawn = 0, seen = {};
      // wave H (knit-qa): a pattern book imports ONE pattern (or a few); the
      // charts kept are those its own text names, not the book's other
      // patterns' (the lace book's Sophia shrug came with the Icelandic
      // shawl's Charts A-F and the Henley's laces)
      var mentionText = knitImportedText(projectId);
      (pages || []).forEach(function (pg) {
        (pg && pg.charts || []).forEach(function (c) {
          if (!c) return;
          // wave K (E12): a book pattern keeps only the charts on its own pages
          if (!knitPageInside(pg.page, within)) return;
          if (mentionText !== null && !knitChartMentioned(c.name, mentionText)) return;
          found.push({ page: pg.page, name: String(c.name || ''), chart: slimChart(c) });
          if (seen[pg.page] || drawn >= KNIT_CHART_PAGES_MAX) return;
          seen[pg.page] = true;
          drawn++;
          work = work.then(function () {
            if (sig.cancelled) return null;
            return handle.renderPage(pg.page, { scale: KNIT_CHART_SCALE, signal: sig }).then(function (canvas) {
              return new Promise(function (res) {
                try { canvas.toBlob(function (b) { res(b); }, 'image/jpeg', 0.85); } catch (e) { res(null); }
              });
            }).then(function (blob) { if (blob) blobs[pg.page] = blob; }, function () { /* no image: the chart still counts */ });
          });
        });
      });
      return work;
    }).then(function () {
      if (!found.length || !Store.project(projectId)) return;
      var B = window.BlobStore;
      var puts = [];
      var entries = found.map(function (f) {
        var has = !!blobs[f.page];
        var key = 'p:' + projectId + ':chartpage:' + f.page;
        if (has && !puts.some(function (x) { return x.key === key; })) puts.push({ key: key, value: blobs[f.page] });
        return { page: f.page, name: f.name, key: has ? key : undefined, scale: has ? KNIT_CHART_SCALE : undefined, noImage: !has, chart: f.chart };
      });
      var stored = puts.length && B && typeof B.putMany === 'function' ? B.putMany(puts) : Promise.resolve(0);
      return stored.then(function () {
        if (!Store.project(projectId)) return;
        var pages = entries.map(function (e) { return e.page; });
        var keep = Store.chartPages(projectId).filter(function (c) { return pages.indexOf(c.page) < 0; });
        Store.setChartPages(projectId, keep.concat(entries), { undo: false });
        var cur = currentProject();
        if (cur && cur.id === projectId) render();
        toast(plural(entries.length, 'chart') + ' read and kept with the project', { ms: 2400 });
      });
    }).then(function () {
      if (knitScanSignal === sig) knitScanSignal = null;
    }, function () {
      /* the pattern imported; only the charts are missing (or a newer import cancelled them) */
      if (knitScanSignal === sig) knitScanSignal = null;
    });
    return true;
  }

  /**
   * The chart's rectangle on the kept page image, in image pixels: its box
   * in PDF points (y up from the bottom of the page) times the image's px
   * per point, with a margin. `pageBox` on a turned chart (its `bbox` is in
   * the turned frame). `y(imageHeight)` flips the box onto the picture.
   * null when the box or the image scale is missing.
   */
  function knitChartCrop(chi) {
    var c = chi && chi.chart;
    var s = chi && chi.page && chi.page.scale;
    var b = c ? (c.pageBox && (c.turned || !c.bbox) ? c.pageBox : c.bbox) : null;
    if (!b || !(s > 0) || !(b.x1 > b.x0) || !(b.y1 > b.y0)) return null;
    var pad = 10;
    return {
      x: (b.x0 - pad) * s,
      w: (b.x1 - b.x0 + 2 * pad) * s,
      h: (b.y1 - b.y0 + 2 * pad) * s,
      y: function (imageHeight) { return imageHeight - (b.y1 + pad) * s; }
    };
  }

  /* ---- the chart sheet: the page image, and the row written out ---- */

  function openKnitChartSheet(projectId, partId) {
    // wave K (knit-ui): the craft's own chart sheet (your row on the chart) when it has one
    if (window.AppKnitting && typeof window.AppKnitting.openChartSheet === 'function') {
      return window.AppKnitting.openChartSheet(projectId, partId);
    }
    var p = Store.project(projectId);
    var prt = Store.part(p, partId);
    if (!p || !prt) return;
    var chi = Store.chartInfo(prt);
    if (!chi) return;
    var url = null;
    var zoom = 100;
    openSheet({
      subject: projectId,
      title: chi.name + (chi.row ? ' · row ' + chi.row + (chi.of ? ' of ' + chi.of : '') : ''),
      cls: 'sheet-knit-chart',
      onClose: function () { if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } } },
      build: function (body) {
        var si = Store.sideInfo(prt, p);
        if (chi.text) {
          var dir = si.inRound ? 'read right to left' : si.side === 'ws' ? 'WS, read left to right' : si.side === 'rs' ? 'RS, read right to left' : '';
          // wave H (knit-qa-2): a panel the pattern writes out is read as written
          if (chi.textSource === 'pattern') dir = si.inRound ? '' : (si.side === 'ws' ? 'WS, as the pattern writes it' : si.side === 'rs' ? 'RS, as the pattern writes it' : 'as the pattern writes it');
          var w = el('div', 'knit-chart-row');
          w.appendChild(el('div', 'field-label', 'Row ' + chi.row + (dir ? ' (' + dir + ')' : '')));
          w.appendChild(el('div', 'knit-chart-text', chi.text));
          body.appendChild(w);
        } else if (chi.page && chi.page.chart && chi.page.chart.cells) {
          // KnitChart returns null for a row with a symbol it does not know:
          // the page says it, a guess never does
          var pc = chi.page.chart;
          var notDrawn = chi.row && Array.isArray(pc.rowNos) && pc.rowNos.length && pc.rowNos.indexOf(chi.row) < 0;
          body.appendChild(el('div', 'field-hint', notDrawn
            ? 'Row ' + chi.row + ' is not drawn on the chart: work it as the pattern says.'
            : 'This row could not be written out from the chart; read it from the page.'));
        }
        // what was read off the chart even when its cells were not
        var rc = chi.page && chi.page.chart ? chi.page.chart : null;
        if (rc) {
          var facts = [];
          if (rc.rows > 0) facts.push(rc.rows + ' rows');
          if (rc.cols > 0) facts.push(rc.cols + ' sts wide');
          if (rc.repeatBox && rc.repeatBox.c1 >= rc.repeatBox.c0) facts.push('repeat ' + (rc.repeatBox.c1 - rc.repeatBox.c0 + 1) + ' sts');
          if (facts.length) body.appendChild(el('div', 'field-hint', chi.name + ': ' + facts.join(' · ')));
          var legend = Array.isArray(rc.legend) ? rc.legend.filter(function (l) { return l && (l.meaning || l.text); }) : [];
          if (legend.length) {
            var key = document.createElement('details');
            key.className = 'knit-gloss-more';
            var ks = document.createElement('summary');
            ks.textContent = 'Key (' + legend.length + ')';
            key.appendChild(ks);
            legend.slice(0, 40).forEach(function (l) {
              var r = el('div', 'knit-gloss-row');
              r.appendChild(el('span', 'knit-gloss-abbr', String(l.stitch || l.text || l.sym || '').slice(0, 14)));
              r.appendChild(el('span', 'knit-gloss-meaning', String(l.meaning || l.text || '')));
              key.appendChild(r);
            });
            body.appendChild(key);
          }
        }
        var stage = el('div', 'knit-chart-stage');
        body.appendChild(stage);
        if (!chi.page || !chi.page.key) {
          // wave H (knit-qa-2): a written-out panel needs no page
          if (chi.textSource !== 'pattern') {
            stage.appendChild(el('div', 'field-hint', 'The page this chart is printed on is not kept with the project. ' +
              'Import the PDF again (⋯ → Import pattern) to keep its chart pages.'));
          }
          return;
        }
        var B = window.BlobStore;
        if (!B || typeof B.get !== 'function') {
          stage.appendChild(el('div', 'field-hint', 'Page images are not available in this browser.'));
          return;
        }
        var img = document.createElement('img');
        img.className = 'knit-chart-img';
        img.alt = chi.name + ', page ' + chi.page.page;
        stage.appendChild(el('div', 'field-hint', 'Loading page ' + chi.page.page + '…'));
        var tools = el('div', 'row-flex knit-chart-tools');
        var minus = button('btn ghost', '−', 'Zoom out');
        var plusB = button('btn ghost', '+', 'Zoom in');
        function setZoom(z) { zoom = Math.max(100, Math.min(400, z)); img.style.width = zoom + '%'; }
        on(minus, 'click', function () { setZoom(zoom - 50); });
        on(plusB, 'click', function () { setZoom(zoom + 50); });
        tools.appendChild(minus);
        tools.appendChild(plusB);
        B.get(chi.page.key).then(function (blob) {
          clear(stage);
          if (!blob) {
            stage.appendChild(el('div', 'field-hint', 'Page ' + chi.page.page + ' is not on this device any more. Import the PDF again to keep it.'));
            return;
          }
          url = URL.createObjectURL(blob);
          body.insertBefore(tools, stage);
          // the chart itself, cropped out of the page by its box in PDF
          // points (pageBox on a sideways chart); "Whole page" shows the rest
          var crop = knitChartCrop(chi);
          if (!crop) {
            img.src = url;
            stage.appendChild(img);
            return;
          }
          var whole = button('btn ghost', 'Whole page', 'Show the whole page');
          tools.insertBefore(whole, tools.firstChild);
          var full = false;
          img.onload = function () {
            if (full) return;
            var cv = document.createElement('canvas');
            var sx = Math.max(0, crop.x), sy = Math.max(0, crop.y(img.naturalHeight));
            var sw = Math.min(img.naturalWidth - sx, crop.w), sh = Math.min(img.naturalHeight - sy, crop.h);
            if (!(sw > 4 && sh > 4)) { stage.appendChild(img); return; }
            cv.width = Math.round(sw);
            cv.height = Math.round(sh);
            try {
              cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
              cv.toBlob(function (b) {
                if (!b) { stage.appendChild(img); return; }
                var u2 = URL.createObjectURL(b);
                img.onload = null;
                img.dataset.cropUrl = u2;
                img.src = u2;
                stage.appendChild(img);
              }, 'image/png');
            } catch (e) { stage.appendChild(img); }
          };
          on(whole, 'click', function () {
            full = !full;
            img.onload = null;
            img.src = full ? url : (img.dataset.cropUrl || url);
            whole.textContent = full ? 'Just the chart' : 'Whole page';
          });
          img.src = url;
        });
      }
    });
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

  /* ---- wave K (01 P13): on a long knitting row a tap counts a repeat ----
   * On a knitting row of 40 stitches or more whose stitches fall into the
   * row's real repeat groups (Store.rowGroups: the runs that add up exactly
   * to the target) — or, without those, into marker segments on a row the
   * markers were set for — one tap counts the stitches up to the end of the
   * repeat or segment it is in. A long press (or Settings for the project:
   * ⋯ → "Tap counts: stitches") counts one stitch. Crochet never does this;
   * nor does a short row, a row with no target, or a row whose groups the
   * counter cannot vouch for.
   * The setting: settings.crafts.knitting.tapUnit = { <projectId>: 'stitch' }
   * (absent = repeats on long rows), a device setting with no undo step.
   */
  var KNIT_LONG_ROW = 40;
  var LONG_PRESS_MS = 550;

  function knitTapUnit(p) {
    if (!isKnit(p) || typeof Store.craftSettings !== 'function') return 'stitch';
    var m = (Store.craftSettings(KNIT_ID) || {}).tapUnit;
    return m && typeof m === 'object' && m[p.id] === 'stitch' ? 'stitch' : 'repeat';
  }

  function setKnitTapUnit(p, unit) {
    if (!p || typeof Store.setCraftSetting !== 'function') return;
    var old = (Store.craftSettings(KNIT_ID) || {}).tapUnit;
    var next = {};
    if (old && typeof old === 'object') {
      Object.keys(old).forEach(function (id) { if (old[id] === 'stitch' && Store.project(id)) next[id] = 'stitch'; });
    }
    if (unit === 'stitch') next[p.id] = 'stitch'; else delete next[p.id];
    Store.setCraftSetting(KNIT_ID, 'tapUnit', next);
  }

  /**
   * The ends (stitch counts) of the units a tap counts on this row, or null
   * to count stitches. `{ kind: 'repeat'|'segment', ends: [..., target] }`.
   */
  function knitTapUnits(p, prt) {
    if (!p || !prt || !isKnit(p) || knitTapUnit(p) !== 'repeat' || partFinished(prt)) return null;
    var target = Store.currentTarget(prt);
    if (!target || target < KNIT_LONG_ROW) return null;
    var sr = null;
    try { sr = typeof Store.shortRowInfo === 'function' ? Store.shortRowInfo(prt) : null; } catch (e) { sr = null; }
    if (sr) return null;
    var rg = null;
    try { rg = typeof Store.rowGroups === 'function' ? Store.rowGroups(prt) : null; } catch (e2) { rg = null; }
    var ends = [], cum = 0;
    if (rg && rg.runs && rg.runs.length >= 2 && rg.total === target) {
      rg.runs.forEach(function (r) { cum += r.size; ends.push(cum); });
      return ends[ends.length - 1] === target ? { kind: 'repeat', ends: ends } : null;
    }
    // marker segments, only on a row the markers were set for
    var ms = Array.isArray(prt.markers) ? prt.markers : [];
    if (ms.length && prt.markerTotal === target) {
      var at = ms.map(function (m) { return m && typeof m.at === 'number' ? m.at : -1; })
        .filter(function (a) { return a > 0 && a < target; })
        .sort(function (a, b) { return a - b; });
      at.forEach(function (a) { if (!ends.length || ends[ends.length - 1] !== a) ends.push(a); });
      ends.push(target);
      return ends.length >= 2 ? { kind: 'segment', ends: ends } : null;
    }
    return null;
  }

  /** How many stitches one tap counts from `stitch`: to the end of its unit (1 past the row). */
  function knitTapStep(units, stitch) {
    if (!units) return 1;
    for (var i = 0; i < units.ends.length; i++) if (units.ends[i] > stitch) return units.ends[i] - stitch;
    return 1;
  }

  /**
   * Count `n` stitches as one action. `Store.tapStitches` (one undo step)
   * when the store has it; else `n` single taps stopping at a row's end, the
   * last result applied (announcement and buzz once).
   */
  function tapMany(p, prt, n) {
    if (typeof Store.tapStitches === 'function') return Store.tapStitches(p.id, prt.id, n);
    var res = null;
    var startRow = prt.row, startPart = prt.id;
    for (var i = 0; i < n; i++) {
      res = Store.tapStitch(p.id, prt.id);
      var cp = Store.activePart(Store.project(p.id));
      if (!res || res.event === 'none' || !cp || cp.id !== startPart || cp.row !== startRow) break;
    }
    return res;
  }

  function doStitchTap(opts) {
    var p = currentProject();
    if (!p) return false;
    var prt = Store.activePart(p);
    if (!prt) return false;
    var units = opts && opts.single ? null : knitTapUnits(p, prt);
    if (units) {
      var n = knitTapStep(units, prt.stitch);
      if (n > 1) {
        applyResult(tapMany(p, prt, n));
        return true;
      }
    }
    applyResult(Store.tapStitch(p.id, prt.id));
    return true;
  }

  /** The one-line hint under the readout while taps count repeats (knitting only). */
  function syncKnitTapHint(p, prt) {
    var units = knitTapUnits(p, prt);
    var hint = document.getElementById('knit-tap-unit');
    if (!units) {
      if (hint) hint.hidden = true;
      if (els.stitchBtn) els.stitchBtn.removeAttribute('aria-description');
      return;
    }
    if (!hint && els.stitchReadout && els.stitchReadout.parentNode) {
      hint = el('div', 'knit-tap-unit');
      hint.id = 'knit-tap-unit';
      els.stitchReadout.parentNode.insertBefore(hint, els.stitchReadout.nextSibling);
    }
    var n = knitTapStep(units, prt.stitch);
    var what = units.kind === 'repeat' ? 'repeat' : 'marker segment';
    var text = 'Tap = 1 ' + what + ' (' + n + ' st' + (n === 1 ? '' : 's') + ') · hold = 1 st';
    if (hint) { hint.textContent = text; hint.hidden = false; }
    if (els.stitchBtn) {
      els.stitchBtn.setAttribute('aria-description', 'Each tap counts one ' + what + ', ' + n + ' stitch' +
        (n === 1 ? '' : 'es') + ' now. Hold to count one stitch.');
    }
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
      // wave K (P13): while taps count repeats, a long press counts one stitch
      var cpL = currentProject();
      if (cpL && knitTapUnits(cpL, Store.activePart(cpL))) {
        var mine = tapState;
        mine.longTimer = window.setTimeout(function () {
          if (tapState !== mine || mine.dragging) return;
          mine.long = true;
          btn.classList.remove('pressed');
          doStitchTap({ single: true });
        }, LONG_PRESS_MS);
      }
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
      if (tapState.longTimer) window.clearTimeout(tapState.longTimer);
      // a long press already counted its one stitch
      var counted = !tapState.dragging && !tapState.long;
      end();
      if (counted) doStitchTap();
    });

    on(btn, 'pointercancel', function (e) {
      if (tapState && e.pointerId !== tapState.id) return;
      if (tapState && tapState.longTimer) window.clearTimeout(tapState.longTimer);
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
  /** How many times a lost context has been rebuilt; two is plenty. */
  var diagramRecoveries = 0;
  var viewer = {
    handle: null, canvas: null, readout: null, sheet: null,
    orientSeg: null, orientHint: null
  };

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

  /*
   * Wave F — "3D follows your stitches" (the owner's request): every tap turns
   * the piece by 360°/count so the stitch just made stays at the front. On by
   * default. Stored in crochet's own settings bag (`Store.craftSettings
   * ('crochet').diagramFollow`), the existing per-craft preferences API, because
   * `Store.setSetting` only takes keys the store already declares; absent
   * means on. Read and written only through these two functions.
   */
  var DIAGRAM_FOLLOW_KEY = 'diagramFollow';
  function diagramFollowOn() {
    try {
      var bag = typeof Store.craftSettings === 'function' ? Store.craftSettings('crochet') : null;
      return !(bag && bag[DIAGRAM_FOLLOW_KEY] === false);
    } catch (e) {
      return true;
    }
  }

  function setDiagramFollow(on) {
    on = !!on;
    try {
      if (typeof Store.setCraftSetting === 'function') Store.setCraftSetting('crochet', DIAGRAM_FOLLOW_KEY, on);
    } catch (e) {
      /* a failed save must not stop the piece turning (or not) right now */
    }
    [live.handle, viewer.handle].forEach(function (h) {
      if (!h || typeof h.setFollow !== 'function') return;
      try {
        h.setFollow(on);
      } catch (e2) {
        /* ignore */
      }
    });
    syncFollowButton();
  }

  /** The viewer header's follow button, in step with the stored setting. */
  function syncFollowButton() {
    // wave I: the working mode's Turn chips write the same setting
    if (workPanelIsOpen() && work.segs.follow) work.segs.follow.set(diagramFollowOn() ? 'on' : 'off');
    var b = viewer.followBtn;
    if (!b) return;
    var on = diagramFollowOn();
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function cssVar(cs, name, fallback) {
    var v = (cs.getPropertyValue(name) || '').trim();
    return v || fallback;
  }

  /** '#abc' / '#aabbcc' / 'rgb(…)' → [r, g, b] 0..255, or null. */
  function rgbOf(color) {
    var c = String(color || '').trim();
    if (c.charAt(0) === '#') {
      var hex = c.slice(1);
      if (hex.length === 3) {
        hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
      }
      if (!/^[0-9a-fA-F]{6}/.test(hex)) return null;
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    var m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (!m) return null;
    var parts = m[1].split(/[,\s/]+/).filter(function (x) { return x.length; });
    if (parts.length < 3) return null;
    return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
  }

  function relLum(color) {
    var rgb = rgbOf(color);
    if (!rgb) return 0;
    var out = 0;
    var k = [0.2126, 0.7152, 0.0722];
    for (var i = 0; i < 3; i++) {
      var v = Math.min(1, Math.max(0, rgb[i] / 255));
      v = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      out += v * k[i];
    }
    return out;
  }

  /** WCAG contrast ratio between two CSS colours. */
  function contrastRatio(a, b) {
    var la = relLum(a), lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** Whichever candidate reads best against `bg`. */
  function mostReadable(bg, candidates) {
    var best = candidates[0], bestC = -1;
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;
      var c = contrastRatio(bg, candidates[i]);
      if (c > bestC) { bestC = c; best = candidates[i]; }
    }
    return best;
  }

  /**
   * 02 #1: the ghost colour is passed OPAQUE. The renderer owns ghost alpha
   * (GHOST_ALPHA 0.20 / PENDING_ALPHA 0.72); this used to pass
   * rgba(--text, 0.35) on top of that, so future rounds composed to 0.070
   * effective and were invisible in the app — while the test page, which
   * passes an opaque white, looked right. And because `--text` on a light
   * theme is a dark brown sitting on a mid `--primary` (barely 1.1:1), the
   * colour is chosen by contrast against the button rather than by variable.
   */
  function diagramPalette() {
    var cs = window.getComputedStyle(document.documentElement);
    var primary = cssVar(cs, '--primary', '#4f9868');
    var accent2 = cssVar(cs, '--accent-2', '#e6a23c');
    var danger = cssVar(cs, '--danger', '#b65b5b');
    return {
      ghost: mostReadable(primary, [
        cssVar(cs, '--primary-text', '#ffffff'),
        cssVar(cs, '--text', '#000000'),
        '#ffffff'
      ]),
      ink: cssVar(cs, '--primary-text', '#ffffff'),
      glow: accent2,
      /* The "you are over the pattern's count" tint (05 #6). --danger is the
         right word in every theme, with one exception: on dragon-pixel
         --danger IS --primary, so a surplus band would read as a hole in the
         piece rather than as a warning. There, the warm accent takes over. */
      alert: contrastRatio(danger, primary) < 1.3 ? (accent2 || '#d9603f') : danger,
      bg: primary
    };
  }

  /* ---- The "too long to draw live" guard (13 #5) ----
   *
   * Store.diagramModel rebuilds the whole piece whenever the row changes, and
   * that build walks every row of the pattern looking each one up, so its cost
   * grows with the square of the pattern length: measured in the Browser pane,
   * a 1,500-row pattern costs ~1,040 ms per completed row while a 60-row
   * amigurumi costs well under a millisecond. Stitch taps are cheap either way
   * (the model is cached), but a row tap on a long pattern froze the counter.
   *
   * The shell cannot make that build cheaper from here, so it stops asking for
   * it: past the threshold the live canvas inside the tap button is not
   * mounted at all and the piece is only built when the user opens the 3D view
   * on purpose. Everything under the threshold is exactly as it was.
   */
  /* 2026-09-24: `Store.diagramModel` builds a row → line index once instead of
     scanning every parsed line per row, so a 1,500-row pattern now builds in
     under 60 ms where it used to cost ~1,040 ms per completed row. The row cap
     goes 250 → 2,000; the MEASURED-time guard below stays, and `partIsHeavy`
     stays as the safety valve for whatever the cap does not predict. */
  var DIAGRAM_MAX_LIVE_ROWS = 2000;
  var DIAGRAM_BUDGET_MS = 60;
  /** partId -> true once this part has proved too expensive to draw live. */
  var diagramHeavy = Object.create(null);

  function partIsHeavy(prt) {
    if (!prt) return false;
    if (diagramHeavy[prt.id]) return true;
    var rows = 0;
    try {
      var s = Store.patternSummary(prt);
      rows = Math.max(s.maxRow || 0, prt.targetRows || 0, prt.row || 0);
    } catch (e) {
      rows = 0;
    }
    if (rows > DIAGRAM_MAX_LIVE_ROWS) {
      diagramHeavy[prt.id] = true;
      return true;
    }
    return false;
  }

  /** The model for whatever is on screen, or null. */
  function currentModel() {
    var p = currentProject();
    var prt = p ? Store.activePart(p) : null;
    if (!p || !prt) return null;
    var t0 = 0;
    try {
      t0 = window.performance && performance.now ? performance.now() : 0;
    } catch (e) {
      t0 = 0;
    }
    var model;
    try {
      model = Store.diagramModel(prt, p);
    } catch (e) {
      return null;
    }
    // A build that blew the frame budget: never again on the tap path.
    if (t0) {
      try {
        if (performance.now() - t0 > DIAGRAM_BUDGET_MS) diagramHeavy[prt.id] = true;
      } catch (e) { /* ignore */ }
    }
    return model;
  }

  /**
   * How many of the model's rounds are the PATTERN's own, and how wide the
   * widest real row is. The builder appends a round for the row being worked
   * as soon as the pattern's rows run out (`total = max(workingRow, maxRow)`),
   * so a finished 46-row wrap arrives as 47 rounds with a count-less 47th —
   * which is why the viewer's summary used to grow a row the moment the piece
   * was done (07 #7). Nothing that has no stitches in it is fabric, and a row
   * the model builder flagged as an `outlier` is a misparse, not a width.
   * @returns {{rounds:number, wide:number}}
   */
  function modelSpan(model) {
    var rounds = (model && model.rounds) || [];
    var last = rounds.length;
    while (last > 0 && (rounds[last - 1].count | 0) <= 0) last--;
    var wide = 0;
    for (var i = 0; i < last; i++) {
      if (rounds[i].outlier) continue;
      wide = Math.max(wide, rounds[i].count | 0);
    }
    /* A long pattern is modelled as a WINDOW of rounds, so the model's own
       length is not the pattern's length; `window.total` is, minus however
       many trailing count-less rounds the builder added past the end. */
    var total = model && model.window && model.window.total > 0 ? model.window.total : 0;
    var n = total ? Math.max(total - (rounds.length - last), 0) : last;
    return { rounds: n, wide: wide };
  }

  /**
   * Is every round of the piece worked? Drives the viewer's fit purpose: a
   * finished piece is letterboxed honestly rather than over-scaled around the
   * row being counted (07 finding 2). The trailing count-less round the
   * builder appends past the last pattern row is not unfinished work.
   */
  function modelFinished(model) {
    var rounds = (model && model.rounds) || [];
    var any = false;
    for (var i = 0; i < rounds.length; i++) {
      var r = rounds[i];
      if ((r.count | 0) <= 0) continue;
      if (r.ghost || (r.done | 0) < (r.count | 0)) return false;
      // Wave F: a round nothing sized is only as long as what was tapped, so
      // it is always "full" — it is the round being worked, not a finish.
      if (r.countless) return false;
      any = true;
    }
    if (!any) return false;
    // A windowed model only holds part of the piece: the last round it holds
    // has to BE the pattern's last round before the piece can be finished.
    var total = model.window && model.window.total > 0 ? model.window.total : 0;
    var span = modelSpan(model);
    if (total && span.rounds && rounds.length) {
      var lastRow = 0;
      for (i = 0; i < rounds.length; i++) {
        if ((rounds[i].count | 0) > 0) lastRow = rounds[i].row || (i + 1);
      }
      if (lastRow < span.rounds) return false;
    }
    return true;
  }

  /**
   * Push the current model at whatever is mounted.
   * @param {'stitch'|'round'|'none'} animate
   */
  function pushDiagram(animate) {
    if (!live.handle && !viewer.handle) return;
    // Nothing but the deliberately-opened viewer pays for a heavy piece.
    if (!viewer.handle && partIsHeavy(currentPart())) return;
    // wave K (K1): only the viewer, on Whole piece — the single part's model is not needed at all
    if (!live.handle && viewer.handle && viewerWholeOn(currentProject())) {
      pushWhole(currentProject());
      return;
    }
    var model = currentModel();
    if (!model) return;
    var opts = { animate: animate || 'none' };
    /* Both frames are told whether the piece is finished: the geometry keeps
       the counting clamp for the button only while there is still counting to
       do, and letterboxes the finished piece in both. */
    var done = modelFinished(model);
    if (live.handle) {
      try {
        live.handle.setModel(model, { animate: opts.animate, fitPurpose: 'button', finished: done });
      } catch (e) {
        /* a renderer that gave up must not break counting */
      }
    }
    if (viewer.handle) {
      // wave K (K1): a knitting project's whole piece, in the viewer only.
      // A tap (same rows) costs nothing here; a row change rebuilds once,
      // off the tap path (a timeout), and only if the view still wants it.
      var wp = currentProject();
      var wantWhole = viewerWholeOn(wp);
      if (wantWhole) {
        pushWhole(wp);
        return;
      }
      viewer.wholeShown = '';
      try {
        viewer.handle.setModel(model, {
          animate: opts.animate,
          fitPurpose: 'viewer',
          finished: done
        });
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
    syncDiagramInsets();
  }

  /**
   * 05 #1 / 02 #16: hand the renderer the strip the number and the hint
   * occupy, so the piece is fitted and centred in what is left instead of
   * being drawn behind the caption. Measured, not guessed, because the head
   * grows with the theme's --counter-size and with text zoom.
   */
  function syncDiagramInsets() {
    if (!live.handle || typeof live.handle.setSafeInsets !== 'function') return;
    // wave I: in working mode the piece gets what the heads-up layer leaves
    if (work.on && work.session) {
      work.session.measure(false);
      return;
    }
    if (work.session) work.session.resetInsets();
    var head = document.getElementById('stitch-head');
    var hint = document.getElementById('stitch-hint');
    var top = head ? head.offsetHeight : 0;
    // the hint fades out once this piece has been counted on, and its strip
    // goes back to the piece with it
    var counted = !!(els.stitchBtn && els.stitchBtn.classList.contains('counted'));
    var bottom = !counted && hint && !hint.hidden ? hint.offsetHeight + 10 : 0;
    try {
      live.handle.setSafeInsets({ top: top + 4, right: 8, bottom: bottom + 4, left: 8 });
    } catch (e) {
      /* ignore */
    }
  }

  /* Wave I's working-mode free area (portrait: between the readout stack and
     the next line / buttons; landscape: right of the column) is measured by
     the engine now (js/workmode.js `measure`), and handed to the piece through
     the session's `onInsets` only when it changed. */

  /** Just the canvas and its renderer; the "3D view" button stays. */
  /**
   * The canvas element goes too, so the GL context is RELEASED rather than
   * left alive on a detached node. A page gets a handful of WebGL contexts and
   * the browser drops the oldest without a word once they run out — which is
   * how the ⤢ viewer came up blank after a few opens (05 #7).
   */
  function destroyLiveCanvas() {
    if (live.handle) {
      try {
        live.handle.destroy({ release: true });
      } catch (e) {
        /* ignore */
      }
      live.handle = null;
    }
    if (live.canvas && live.canvas.parentNode) live.canvas.parentNode.removeChild(live.canvas);
    live.canvas = null;
    if (els.stitchBtn) els.stitchBtn.classList.remove('has-diagram');
  }

  function destroyLiveDiagram() {
    destroyLiveCanvas();
    if (live.btn && live.btn.parentNode) live.btn.parentNode.removeChild(live.btn);
    live.btn = null;
  }

  /** Mount (or refresh) the canvas inside the stitch button. */
  function mountLiveDiagram() {
    if (!diagramEnabled() || !els.stitchBtn) {
      destroyLiveDiagram();
      return;
    }
    ensureThreeDButton();
    // A pattern long enough that rebuilding the piece costs more than a frame
    // keeps the 3D view button but not the live canvas (13 #5).
    if (partIsHeavy(currentPart())) {
      destroyLiveCanvas();
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
          interactive: false,
          /* The button's frame is 100 px of a tap target, so the geometry's
             bounded button clamp applies here and the sheet is centred in
             what the caption leaves free (07 finding 2). */
          fitPurpose: 'button',
          finished: modelFinished(currentModel()),
          // Wave F: the piece turns with the taps (Settings / viewer chip).
          follow: diagramFollowOn(),
          /* The renderer tells us when there is no piece on screen (a refused
             or lost context). In the button there is nowhere to put a message,
             so the canvas simply goes away and the plain number is back — the
             counter must never look broken. */
          onStatus: function (s) {
            /* 'unavailable' is fine here: the renderer never got a GL context
               on this canvas, so its own Canvas-2D silhouette draws and the
               button still shows the piece. 'lost' / 'blank' are different —
               that canvas can never be given a context again, so throw it away
               and let the next render mount a fresh one (on a device that has
               simply run out of contexts, the plain number is what is left,
               which is the counter working normally). */
            if (!s || s.webgl || (s.status !== 'lost' && s.status !== 'blank')) return;
            if (diagramRecoveries >= 2) return;
            diagramRecoveries += 1;
            window.setTimeout(function () {
              destroyLiveCanvas();
              if (els.project && !els.project.hidden) mountLiveDiagram();
            }, 0);
          }
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
      // wave I: a fresh handle has no insets yet, whatever was handed before
      if (work.session) work.session.resetInsets();
    }
    els.stitchBtn.classList.add('has-diagram');
    resizeDiagrams();
    pushDiagram('none');
    syncDiagramInsets();
  }

  /**
   * 02 #8 / 07 #7–#8: this used to be a 44×44 hole punched in the top-right
   * corner of the tap button, so a mis-tap cost a stitch and opened a modal,
   * it was last in the tab order, and its glyph failed WCAG 1.4.11 on the two
   * dark `--primary-text` themes (1.81:1 and 2.53:1). It is now a labelled
   * control in the actions row, on `--surface-2`, in DOM order.
   */
  function ensureThreeDButton() {
    if (live.btn || !els.stitchActions) return;
    // Plain `.btn` on purpose: --surface-2 / --text is a pair every theme
    // designed to contrast, unlike the old --primary-text on a black scrim.
    // Wave I: it opens the full-screen working mode (15c); the old viewer
    // sheet is one tap further, under the mode's Options → Whole piece.
    var b = button('btn stitch-3d', null, 'Work in 3D: count full screen with the piece');
    b.id = 'stitch-3d';
    b.setAttribute('data-tour', 'stitch-3d');
    b.appendChild(el('span', 'stitch-3d-glyph', '⤢'));
    b.appendChild(el('span', 'stitch-3d-label', 'Work in 3D'));
    on(b, 'click', function (e) {
      e.stopPropagation();
      openWorkMode();
    });
    var reset = document.getElementById('stitch-reset');
    if (reset && reset.parentNode === els.stitchActions) {
      els.stitchActions.insertBefore(b, reset);
    } else {
      els.stitchActions.appendChild(b);
    }
    live.btn = b;
  }

  /** "Rnd 5 · 13 / 24" for the viewer header. */
  function viewerReadoutText(p, prt) {
    if (!p || !prt) return '';
    /* Wave E (07, viewer header row): a finished piece has no round being
       worked, so the working round (row + 1) read "Row 47 · 0 sts" at 46/46.
       The last round it HAS is the one to name. */
    if (partFinished(prt)) {
      return partShortRowWord(p, prt) + ' ' + prt.targetRows + ' · done';
    }
    var ri = Store.repeatInfo(prt);
    var target = Store.currentTarget(prt);
    var text = partShortRowWord(p, prt) + ' ' + ri.workingRow + ' · ' + prt.stitch;
    text += target ? ' / ' + target : ' sts';
    return text;
  }

  /**
   * The viewer header: "Rnd 29 · 3 / 36", and under it, only when the round
   * being worked prints a total its own instructions do not make, "Pattern
   * says 36 · instructions add up to 24" (Wave E). The target stays printed.
   */
  function setViewerReadout(node, p, prt) {
    if (!node) return;
    clear(node);
    node.appendChild(document.createTextNode(viewerReadoutText(p, prt)));
    var note = '';
    if (prt && !partFinished(prt)) {
      try { note = countCheckText(Store.roundDeviation(prt)); } catch (e) { note = ''; }
    }
    if (note) node.appendChild(el('span', 'viewer-readout-note', note));
  }

  /**
   * What the geometry made of this piece, in the words a crocheter uses:
   * "Sphere · 15 rounds · 48 around". Everything comes from
   * `DiagramGeo.classify`, so the viewer can never claim a shape the renderer
   * did not draw.
   */
  function shapeName(cls, corners) {
    if (!cls) return 'Piece';
    var k = corners || cls.corners || 0;
    // wave H (knit-qa): a knitted piece in the words a knitter uses. A yoke
    // or a sock comes from what DiagramGeo bent or widened (`cls.knit`); an
    // open knitted ring is never a crochet "Flat circle" (that starts from a
    // closed centre): it is a cone when it widens, a band when it does not.
    if (cls.knit && cls.mode !== 'rows') {
      if (cls.knit.yoke) return 'Raglan yoke';
      if ((cls.knit.bends && cls.knit.bends.length) || cls.knit.toeUp) return 'Sock';
      if (!cls.closedTop && !cls.closedBottom && (cls.aspect || 0) < 0.38) {
        var kr = cls.rounds.filter(function (r) { return !r.empty; });
        var r0 = kr.length ? (kr[0].radius || 0) : 0, r1 = kr.length ? (kr[kr.length - 1].radius || 0) : 0;
        // (knit-qa-2: one that narrows — a Top Yoke 220 → 100 — is a cone too)
        var kGrew = kr.length > 1 && (r1 > r0 * 1.3 || r0 > r1 * 1.3);
        return kGrew ? 'Cone' : 'Band';
      }
    }
    if (cls.knit && cls.mode === 'rows' && cls.knit.chevron) return 'Triangle';
    if (cls.mode === 'rows') {
      if (cls.anchor === 'spine') return 'Triangle';
      if (cls.anchor === 'left' || cls.anchor === 'right') return 'Shaped panel';
      return 'Flat panel';
    }
    if (k === 3) return 'Triangle motif';
    if (k === 4) return 'Square motif';
    if (k === 6) return 'Hexagon motif';
    if (k === 8) return 'Octagon motif';
    if (cls.ruffles > 1) return 'Ruffle';
    var rounds = [];
    var i;
    for (i = 0; i < cls.rounds.length; i++) {
      if (!cls.rounds[i].empty) rounds.push(cls.rounds[i].radius || 0);
    }
    if (!rounds.length) return 'Piece';
    var a = cls.aspect || 0;
    var closed = !!(cls.closedTop && cls.closedBottom);
    var maxR = 0;
    for (i = 0; i < rounds.length; i++) maxR = Math.max(maxR, rounds[i]);
    var last = rounds[rounds.length - 1];
    var shrank = maxR > 0 && last < maxR * 0.62;
    var grew = last > rounds[0] * 1.3;
    if (a < 0.38) return closed ? 'Bobble' : 'Flat circle';
    /* 06 #12: a 20-round, aspect-1.49, closed-top open-bottom piece was called
       a "Dome", and a dome is by definition squat — 01 §2.1 calls that an egg.
       A closed top is what makes a piece an egg / a ball; "Dome" is left for
       the open-rimmed cups (shrank, no cap) it actually describes. */
    if (cls.closedTop && a > 1.2) return a >= 2.4 ? 'Capsule' : 'Egg';
    if (cls.closedTop && a >= 0.9) return 'Sphere';
    if (closed) return a <= 1.35 ? 'Sphere' : 'Capsule';
    if (shrank) return 'Dome';
    if (grew) return 'Cone';
    if (a >= 1.5) return 'Tube';
    return 'Bowl';
  }

  /** @returns {{name:string, detail:string}|null} */
  function shapeSummary(model) {
    if (!model || !window.DiagramGeo || typeof DiagramGeo.classify !== 'function') return null;
    var cls;
    try {
      cls = DiagramGeo.classify(model);
    } catch (e) {
      return null;
    }
    if (!cls || !cls.rounds || !cls.rounds.length) return null;
    /* The pattern's own rows and its widest real row — NOT `model.rounds.length`
       and not `max(count)` over every round, which counted the working round
       the builder appends past the end and quoted a misparsed row as a width
       (07 #7: "46 rows" turning into "47 rows · 406 wide" on completion). */
    var span = modelSpan(model);
    var n = span.rounds;
    var wide = span.wide;
    /* How many corners the piece has, when anything knows: the model builder's
       text fallback (`shape.corners`) or the geometry's own count. */
    var corners = (model.shape && model.shape.corners) || cls.corners || 0;
    var bits = [];
    if (cls.mode === 'rows') {
      bits.push(n + ' row' + (n === 1 ? '' : 's'));
      if (corners > 0) bits.push(corners + ' corner' + (corners === 1 ? '' : 's'));
      if (wide) bits.push(wide + ' wide');
    } else {
      bits.push(n + ' round' + (n === 1 ? '' : 's'));
      if (corners > 0) bits.push(corners + ' corner' + (corners === 1 ? '' : 's'));
      if (wide) bits.push(wide + ' around');
    }
    /* Which way up the renderer really drew it (3D wave C). `model.shape` is
       what went to the geometry, chip or pattern text, so the line cannot claim
       an orientation the piece was not built with. */
    if (model.shape && model.shape.upsideDown) bits.push('worked bottom-up');
    return { name: shapeName(cls, corners), detail: bits.join(' · ') };
  }

  /**
   * Put the viewer's orientation chips and their hint back in step with the
   * STORE, so an Undo (or a chip tapped in the part editor) moves them too.
   */
  function syncViewerOrientation() {
    if (!viewer.orientSeg) return;
    var p = currentProject();
    var prt = p ? Store.activePart(p) : null;
    if (!prt) return;
    var pick = partOrientation(prt);
    viewer.orientSeg.set(pick);
    if (viewer.orientHint) viewer.orientHint.textContent = orientationHint(pick, prt);
    // Wave E: the other two chip rows follow the Store the same way, so an
    // Undo moves Worked in and Terms too (only orientation used to).
    if (viewer.modeSeg) viewer.modeSeg.set(prt.workMode === 'rounds' || prt.workMode === 'rows' ? prt.workMode : 'auto');
    if (viewer.dialectSeg) {
      var dpick = partDialectPick(prt);
      viewer.dialectSeg.set(dpick);
      if (viewer.dialectHint) viewer.dialectHint.textContent = dialectHint(dpick, prt, true);
    }
  }

  /* ---- wave K (K1, docs/wave-k/api/knit-3d.md): the whole piece ----------
   * A knitting project of two or more parts can show, in the ⤢ viewer only,
   * every part joined into one thing — the sock, the pullover — or, when the
   * geometry cannot join them honestly, the pieces laid out on a board with
   * the reason why. The stitch button always stays on the part being counted.
   * The choice is remembered per project as a device setting (no undo):
   * `settings.crafts.knitting.viewWhole = { <projectId>: true }`.
   */
  var assembled = { key: '', a: null };

  function wholeAvailable(p) {
    return !!(p && isKnit(p) && p.parts && p.parts.length >= 2 &&
      window.DiagramGeo && typeof window.DiagramGeo.assemble === 'function');
  }

  function viewerWholeOn(p) {
    if (!wholeAvailable(p) || typeof Store.craftSettings !== 'function') return false;
    var w = (Store.craftSettings('knitting') || {}).viewWhole;
    return !!(w && typeof w === 'object' && w[p.id] === true);
  }

  function setViewerWhole(p, onFlag) {
    if (!p || typeof Store.setCraftSetting !== 'function') return;
    var old = (Store.craftSettings('knitting') || {}).viewWhole;
    var next = {};
    // keep only projects that still exist
    if (old && typeof old === 'object') {
      Object.keys(old).forEach(function (id) { if (old[id] === true && Store.project(id)) next[id] = true; });
    }
    if (onFlag) next[p.id] = true; else delete next[p.id];
    Store.setCraftSetting('knitting', 'viewWhole', next);
  }

  /** `DiagramGeo.assemble` over the project's parts, rebuilt only when a count moved. */
  /**
   * What the assembled piece depends on: rows, pieces, the active part and
   * the per-part readings — NOT the stitch. A stitch tap never changes it, so
   * a tap never rebuilds (the pullover is ~132k vertices, hundreds of ms on a
   * phone); only a row change, a part switch or a chip does, off the tap path.
   */
  function wholeKey(p) {
    var act = Store.activePart(p);
    // with handle.setDone (knit-3d) a row or a stitch only moves progress: the
    // key is the STRUCTURE (who is working / done / started, the chips, the
    // frame's shape); without it, every part's row too (wave K's first fix)
    var moves = !!(viewer.handle && typeof viewer.handle.setDone === 'function');
    return p.id + '|' + (act ? act.id : '') + '|' + viewerAspectBucket() + '|' + p.parts.map(function (q) {
      var started = q.row > 0 || q.stitch > 0 || q.piecesDone > 0 ? 1 : 0;
      var state = partFinished(q) ? 'd' : (act && q.id === act.id ? 'w' : 't');
      return q.id + ':' + state + started + ':' + (moves ? '' : q.row) + ':' + q.piecesDone + ':' +
        (q.makeCount || 1) + ':' + (q.workMode || '') + ':' + (q.orientation || '');
    }).join(',');
  }

  /** The viewer canvas's width / height (1 without one), and the bucket the key uses. */
  function viewerAspect() {
    var c = viewer.canvas;
    var w = c ? c.clientWidth : 0, h = c ? c.clientHeight : 0;
    return w > 0 && h > 0 ? w / h : 1;
  }
  function viewerAspectBucket() {
    return Math.round(viewerAspect() * 10) / 10;
  }

  /**
   * Move the working part's progress in the shown whole piece without a
   * rebuild (`handle.setDone`, knit-3d): the stitch on a tap, the round on a
   * row change (the part's own model gives the round index, once per row).
   * False when it cannot, so the caller rebuilds instead.
   */
  function wholeProgress(p) {
    var h = viewer.handle;
    var b = viewer.wholeBase;
    if (!h || typeof h.setDone !== 'function' || !b) return false;
    var act = Store.activePart(p);
    if (!act || b.partId !== act.id) return false;
    if (act.row !== b.row || act.piecesDone !== b.pieces) {
      var m = null;
      try { m = Store.diagramModel(act, p); } catch (e) { m = null; }
      if (!m || typeof m.current !== 'number') return false;
      b.round = m.current;
      b.row = act.row;
      b.pieces = act.piecesDone;
    }
    var r = null;
    try { r = h.setDone(act.id, b.round, act.stitch); } catch (e2) { r = null; }
    return !!(r && r.ok);
  }

  function assembledFor(p, fresh) {
    if (!wholeAvailable(p)) return null;
    var act = Store.activePart(p);
    var key = wholeKey(p);
    if (key === assembled.key && !fresh) return assembled.a;
    var list = [];
    assembled.base = null;
    try {
      p.parts.forEach(function (q) {
        var m = Store.diagramModel(q, p);
        if (act && q.id === act.id) {
          assembled.base = { partId: q.id, row: q.row, pieces: q.piecesDone, round: m && typeof m.current === 'number' ? m.current : 0 };
        }
        list.push({
          id: q.id, name: q.name, makeCount: q.makeCount || 1,
          state: partFinished(q) ? 'done' : (act && q.id === act.id ? 'working' : 'todo'),
          model: m
        });
      });
      // the board wraps to the frame's shape (knit-3d): a phone gets shelves, not one long row
      assembled.a = window.DiagramGeo.assemble(list, { aspect: viewerAspect() }) || null;
    } catch (e) {
      assembled.a = null;
    }
    assembled.key = key;
    return assembled.a;
  }

  /**
   * The viewer's whole piece on the tap path: the structure unchanged →
   * move progress in place (`setDone`, microseconds); else, or when that
   * fails, one rebuild just after the tap.
   */
  function pushWhole(p) {
    var wk = wholeKey(p);
    if (wk !== viewer.wholeShown) {
      scheduleWholePush(wk);
    } else if (viewer.handle && typeof viewer.handle.setDone === 'function' && !wholeProgress(p)) {
      viewer.wholeShown = '';
      assembled.key = '';
      scheduleWholePush(wk);
    }
    updateViewerReadout();
  }

  /** The screen turned / the viewer resized: the board re-wraps when the frame's shape changed (once). */
  function wholeResized() {
    var cp = currentProject();
    if (viewer.handle && viewerWholeOn(cp)) pushWhole(cp);
  }
  window.addEventListener('resize', debounce(wholeResized, 200));

  var wholeTimer = null;

  /** Build and push the assembled piece once, after the tap that asked for it has returned. */
  function scheduleWholePush(key) {
    viewer.wholeWanted = key;
    if (wholeTimer) return;
    wholeTimer = window.setTimeout(function () {
      wholeTimer = null;
      var p = currentProject();
      if (!viewer.handle || !p || !viewerWholeOn(p)) return;
      var k = wholeKey(p);
      if (k === viewer.wholeShown) return;
      var A = assembledFor(p);
      if (!A || !A.model) return;
      try {
        viewer.handle.setModel(A.model, { animate: 'none', fitPurpose: 'viewer', finished: !!A.model.finished });
        viewer.wholeShown = k;
        var bb = assembled.base;
        viewer.wholeBase = bb ? { partId: bb.partId, row: bb.row, pieces: bb.pieces, round: bb.round } : null;
        // the stitches of the working round, which the build did not count
        wholeProgress(p);
      } catch (e) { /* the viewer says so through onStatus */ }
      updateViewerReadout();
    }, 0);
  }

  /** The viewer's caption for an assembled model, in plain words. */
  function assembledCaption(A) {
    if (!A) return { name: '', detail: '' };
    if (A.kind === 'sock') return { name: 'The whole sock', detail: 'every part joined, in the order you knit it' };
    if (A.kind === 'sweater-flat') return { name: 'The whole pullover', detail: 'the pieces sewn together' };
    return { name: 'All the pieces', detail: A.reason || 'laid out side by side' };
  }

  function updateViewerReadout() {
    if (!viewer.readout) return;
    var p = currentProject();
    var prt = p ? Store.activePart(p) : null;
    syncViewerOrientation();
    setViewerReadout(viewer.readout, p, prt);
    if (viewer.shape && viewerWholeOn(p)) {
      // never builds here (this runs on the tap path): the last piece built, if it is current
      var A = assembled.key === wholeKey(p) ? assembled.a : null;
      if (A) {
        var cap = assembledCaption(A);
        viewer.shape.textContent = cap.name || prt.name;
        if (viewer.shapeSub) viewer.shapeSub.textContent = cap.detail;
      }
      return;
    }
    if (viewer.shape) {
      var sum = shapeSummary(currentModel());
      viewer.shape.textContent = sum ? sum.name : (prt ? prt.name : '');
      if (viewer.shapeSub) viewer.shapeSub.textContent = sum ? sum.detail : '';
    }
  }

  /**
   * The viewer's canvas is thrown away with the sheet, so its GL context is
   * RELEASED (05 #7). Combined with closing the button's context while the
   * viewer is open, the app never holds more than one context at a time and
   * the "open it ten times and it comes up blank" failure cannot happen.
   */
  function destroyViewer() {
    if (viewer.handle) {
      try {
        viewer.handle.destroy({ release: true });
      } catch (e) {
        /* ignore */
      }
    }
    viewer.handle = null;
    viewer.canvas = null;
    viewer.readout = null;
    viewer.shape = null;
    viewer.shapeSub = null;
    viewer.orientSeg = null;
    viewer.orientHint = null;
    viewer.modeSeg = null;
    viewer.dialectSeg = null;
    viewer.dialectHint = null;
    viewer.followBtn = null;
    viewer.note = null;
    viewer.sheet = null;
    viewer.wholeSeg = null;
    viewer.wholeShown = '';
    viewer.wholeWanted = '';
    // give the button its piece back
    if (els.project && !els.project.hidden) mountLiveDiagram();
  }

  /**
   * Build the viewer's canvas and mount the renderer on it. Called again with
   * a FRESH canvas element if the context is lost or the first frame drew
   * nothing: a canvas whose GL context has gone can never be given another one
   * (and Chrome paints a broken-image glyph on it), so recovering means
   * replacing the element — at which point either WebGL comes back or the
   * renderer's own Canvas-2D silhouette can finally draw. One retry.
   * @returns {boolean} whether a renderer is mounted
   */
  function mountViewerCanvas(stage, prt, attempt) {
    if (viewer.canvas && viewer.canvas.parentNode) {
      viewer.canvas.parentNode.removeChild(viewer.canvas);
    }
    viewer.canvas = null;
    var canvas = document.createElement('canvas');
    canvas.className = 'viewer-canvas';
    canvas.setAttribute('aria-label', prt.name + ' in 3D');
    stage.insertBefore(canvas, stage.firstChild);
    try {
      viewer.handle = window.Diagram.mount(canvas, {
        palette: diagramPalette(),
        reducedMotion: prefersReducedMotion(),
        interactive: true,
        /* The sheet is the "show me the whole piece" frame: a finished piece
           is letterboxed honestly here instead of being blown up around the
           row being counted. `finished` is re-declared on every push. */
        fitPurpose: 'viewer',
        finished: modelFinished(currentModel()),
        // Wave F: opens facing the stitch being worked, and follows it.
        follow: diagramFollowOn(),
        /* Never render nothing (05 #7): if there is no piece on screen the
           viewer says so in one line instead of showing a flat rectangle of
           --primary and letting the user conclude the feature is broken. */
        onStatus: function (s) {
          if (!s || viewer.canvas !== canvas) return;
          if (s.webgl) {
            viewerNote(stage, '');
            return;
          }
          viewerNote(stage, s.message || "Showing a simple outline — 3D isn't available right now.");
          if (attempt < 1 && (s.status === 'lost' || s.status === 'blank')) {
            window.setTimeout(function () {
              if (viewer.canvas !== canvas) return;
              if (viewer.handle) {
                try { viewer.handle.destroy({ release: true }); } catch (e) { /* ignore */ }
                viewer.handle = null;
              }
              mountViewerCanvas(stage, prt, attempt + 1);
            }, 0);
          }
        }
      });
    } catch (e) {
      viewer.handle = null;
    }
    if (!viewer.handle) {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return false;
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
    /* The sheet may still be animating in — size it once it has landed, and
       ask again on the next frame: the stage only reaches its final height
       after the sheet's transform lands, and `resize` re-fits the piece (at
       once, not as a transition) whenever the canvas really did change size.
       Pushing the model a second time instead would start an EASED fit that
       the idle render loop may never finish, leaving the piece at scale 1. */
    window.requestAnimationFrame(function () {
      resizeDiagrams();
      pushDiagram('none');
      updateViewerReadout();
      window.requestAnimationFrame(function () {
        if (!viewer.handle || viewer.canvas !== canvas) return;
        resizeDiagrams();
      });
    });
    return true;
  }

  /** The one-line "it isn't 3D right now" footer inside the viewer stage. */
  function viewerNote(stage, text) {
    if (!stage) return;
    if (!viewer.note) {
      viewer.note = el('div', 'viewer-note', '');
      stage.appendChild(viewer.note);
    }
    viewer.note.textContent = text;
    viewer.note.hidden = !text;
  }

  function openViewerSheet() {
    var p = currentProject();
    var prt = p ? Store.activePart(p) : null;
    if (!p || !prt) return;

    openSheet({
      subject: p.id,
      title: prt.name,
      cls: 'sheet-viewer',
      build: function (body, api) {
        viewer.sheet = api;

        // The round / stitch readout lives in the sheet header, beside the name.
        var readout = el('div', 'viewer-readout', '');
        setViewerReadout(readout, p, prt);
        viewer.readout = readout;
        /* Wave F — the same switch as Settings → "3D follows your stitches",
           as one compact pressed/unpressed button in the header so the stage
           keeps its height. A one-button `.seg` borrows the chips' own "on"
           styling (no new CSS). A device preference, not a part property: no
           Undo, and it moves both canvases at once. */
        var followWrap = el('div', 'seg viewer-follow');
        var followBtn = button(diagramFollowOn() ? 'on' : null, '↻', 'Turns with each stitch');
        followBtn.style.minWidth = '44px';
        followBtn.style.padding = '0 12px';
        followBtn.style.fontSize = '20px';
        followBtn.title = 'Turns with each stitch';
        followWrap.appendChild(followBtn);
        viewer.followBtn = followBtn;
        syncFollowButton();
        on(followBtn, 'click', function () {
          setDiagramFollow(!diagramFollowOn());
          fb('tap');
        });

        var head = api.dialog.querySelector('.sheet-head');
        if (head) {
          var closeBtn = head.querySelector('.sheet-close');
          if (closeBtn) {
            head.insertBefore(readout, closeBtn);
            head.insertBefore(followWrap, closeBtn);
          } else {
            head.appendChild(readout);
            head.appendChild(followWrap);
          }
        } else {
          body.appendChild(readout);
          body.appendChild(followWrap);
        }

        /* What the geometry made of the piece, and the per-part rounds/rows
           override (05 #2 / #12). The shape line is the only place the app
           ever says out loud what it thinks it is drawing. */
        var bar = el('div', 'viewer-bar');
        var shapeBox = el('div', 'viewer-shape');
        var shapeLabel = el('span', null, '');
        var shapeSub = el('span', 'viewer-shape-sub', '');
        shapeBox.appendChild(shapeLabel);
        shapeBox.appendChild(shapeSub);
        viewer.shape = shapeLabel;
        viewer.shapeSub = shapeSub;
        bar.appendChild(shapeBox);
        var modeSeg = segmented(
          [{ id: 'auto', label: 'Auto' }, { id: 'rounds', label: 'Rounds' }, { id: 'rows', label: 'Rows' }],
          prt.workMode === 'rounds' || prt.workMode === 'rows' ? prt.workMode : 'auto',
          function (v) {
            Store.updatePart(p.id, prt.id, { workMode: v });
            pushDiagram('none');
            updateViewerReadout();
            render();
            fb('tap');
          }
        );
        modeSeg.node.setAttribute('aria-label', 'Worked in rounds or rows');
        bar.appendChild(modeSeg.node);
        viewer.modeSeg = modeSeg;

        /* Which way up (3D wave C). Second row of the bar so 375 still fits:
           the chips write `Part.orientation` and the hint says what Auto read
           out of the pattern, the same resolution the model carries. */
        var orientRow = el('div', 'viewer-bar-row');
        var orientHint = el('div', 'viewer-bar-hint', '');
        var orientSeg = segmented(ORIENT_OPTIONS, partOrientation(prt), function (v) {
          Store.updatePart(p.id, prt.id, { orientation: v });
          syncViewerOrientation();
          pushDiagram('none');
          updateViewerReadout();
          render();
          fb('tap');
        });
        orientSeg.node.setAttribute('aria-label', 'Worked top-down or bottom-up');
        orientRow.appendChild(orientSeg.node);
        orientRow.appendChild(orientHint);
        bar.appendChild(orientRow);
        viewer.orientSeg = orientSeg;
        viewer.orientHint = orientHint;

        /* Wave E — which side of the Atlantic named the stitches. Third row,
           same shape as the one above: the chips write `Part.dialect`
           (undoable, template-carried), the hint says what Auto read. It
           moves heights only — a UK tr is a US dc — never a count. */
        var dialectRow = el('div', 'viewer-bar-row viewer-bar-row-inline');
        var dialectLabel = el('span', 'viewer-bar-label', 'Terms');
        var dialectHintEl = el('div', 'viewer-bar-hint', '');
        var dialectSeg = segmented(DIALECT_OPTIONS, partDialectPick(prt), function (v) {
          Store.updatePart(p.id, prt.id, { dialect: v });
          syncViewerOrientation();
          pushDiagram('none');
          updateViewerReadout();
          render();
          fb('tap');
        });
        dialectSeg.node.setAttribute('aria-label', 'Stitch terms: UK or US');
        dialectRow.appendChild(dialectLabel);
        dialectRow.appendChild(dialectSeg.node);
        dialectRow.appendChild(dialectHintEl);
        // wave H: UK / US stitch names are crochet's question, not knitting's
        if (isKnit(p)) dialectRow.hidden = true;
        bar.appendChild(dialectRow);
        viewer.dialectSeg = dialectSeg;
        viewer.dialectHint = dialectHintEl;

        /* wave K (K1): a knitting project of 2+ parts — This part / Whole piece.
           The per-part chips only mean something for one part, so they fold
           away while the whole piece shows. */
        if (wholeAvailable(p)) {
          var wholeRow = el('div', 'viewer-bar-row viewer-whole-row');
          var syncWhole = function () {
            var w = viewerWholeOn(p);
            modeSeg.node.hidden = w;
            orientRow.hidden = w;
          };
          var wholeSeg = segmented(
            [{ id: 'part', label: 'This part' }, { id: 'whole', label: 'Whole piece' }],
            viewerWholeOn(p) ? 'whole' : 'part',
            function (v) {
              setViewerWhole(p, v === 'whole');
              syncWhole();
              pushDiagram('none');
              updateViewerReadout();
              fb('tap');
            }
          );
          wholeSeg.node.setAttribute('aria-label', 'Show this part, or the whole piece');
          wholeSeg.node.setAttribute('data-viewer-whole', '1');
          wholeRow.appendChild(wholeSeg.node);
          bar.insertBefore(wholeRow, bar.firstChild);
          viewer.wholeSeg = wholeSeg;
          syncWhole();
        }

        body.appendChild(bar);
        /* Fill the shape line now, not only on the canvas's first frame: with
           no WebGL (or a throttled rAF) the summary used to stay blank. */
        updateViewerReadout();

        var stage = el('div', 'viewer-stage');
        body.appendChild(stage);

        if (!diagramAvailable()) {
          stage.appendChild(el('div', 'viewer-empty', 'The 3D view is not available on this device.'));
          return;
        }
        /* Only one live GL context at a time: the button's goes away while the
           viewer is open and is rebuilt on close. Opening the viewer used to
           mount a SECOND context beside it, and after a few opens the browser
           started dropping the oldest without a word (05 #7). */
        destroyLiveCanvas();
        if (!mountViewerCanvas(stage, prt, 0)) {
          stage.appendChild(el('div', 'viewer-empty', 'The 3D view could not start.'));
        }
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

  /* ================================================================== *
   * 15c. Working mode (wave I, focus-mode)
   *
   * The owner: "give the app a working mode … where its full screen counting
   * the stitches and rounds". The ⤢ "Work in 3D" button opens it. It is the
   * project screen itself in a full-screen dress (`#screen-project.work-mode`,
   * css/app.css "Wave I — working mode"): the stitch button, with the live 3D
   * piece inside it, fills the screen and stays the one tap target. So the
   * gesture (press-and-release, 12 px tolerance, a swipe spins the piece),
   * the follow turn, the over-count wedge, the alert flash, the
   * announcements and the celebrations are the counter's own, not copies.
   *
   * Over it sits a heads-up layer (`#work-hud`, pointer-events: none except
   * its controls, so a tap on its text still counts): rows done and the
   * stitch count in big digits, the pattern line and the colour / turn /
   * deviation hints MIRRORED from the counter's own nodes (so they are the
   * same text), the next row, and big −1 / Undo / row − / row + buttons that
   * click the counter's own controls. The chips (worked in, way up, terms,
   * turn) fold into the header. Whether the mode was left open is remembered
   * per project (`Store.focusMode` / `Store.setFocusMode`).
   * ================================================================== */

  /*
   * Wave K (docs/wave-k/api/shell-ui.md §1): the mode now runs through the
   * shared engine in js/workmode.js (`WorkMode.create`), the same one every
   * craft's `def.workMode` gets. The engine owns the HUD skeleton (header,
   * corner buttons, Options panel and scrim), the keys (pedal included), the
   * remembered state hand-off, the open / close announcements and the free-area
   * measuring; this section keeps what is the counter's own: the readout stack
   * (`build` / `paint`, unchanged from wave I), the next-row line and the
   * Options chips. `adopt: true` — the counter's stitch button is the surface.
   */
  var work = {
    on: false,
    hud: null,
    n: {},
    session: null,
    segs: {},
    mirrors: Object.create(null),
    nextKey: '',
    // without Store.focusMode (an old cached store.js): this page load only
    fallbackId: null
  };

  function workPanelIsOpen() {
    return !!(work.session && work.session.panelOpen());
  }

  function workWanted(p) {
    if (!p || isCraftProject(p)) return false;
    if (typeof Store.focusMode === 'function') return !!Store.focusMode(p.id);
    return work.fallbackId === p.id;
  }

  function rememberWork(p, onFlag) {
    if (!p) return;
    if (typeof Store.setFocusMode === 'function') Store.setFocusMode(p.id, onFlag);
    work.fallbackId = onFlag ? p.id : null;
  }

  /** What the counter says, in one sentence: "Round 4: 3 of 18 stitches". */
  function workCountSentence(p, prt) {
    if (!p || !prt) return '';
    if (partFinished(prt)) return 'All ' + prt.targetRows + ' ' + partRowWord(p, prt).toLowerCase() + 's done';
    var ri = Store.repeatInfo(prt);
    var target = Store.currentTarget(prt);
    return rowWordAt(p, prt, ri.workingRow) + ' ' + ri.workingRow + ': ' +
      (target ? prt.stitch + ' of ' + target : String(prt.stitch)) + ' ' + (prt.stitch === 1 && !target ? 'stitch' : 'stitches');
  }

  /** The shell's side of every working-mode session (crochet's and the crafts'). */
  function workEnv(host) {
    return {
      remember: function (onFlag) { rememberWork(currentProject(), onFlag); },
      announce: announce,
      counted: counted,
      fb: fb,
      render: render,
      undo: function () { if (Store.canUndo()) { Store.undo(); render(); } },
      canUndo: function () { return Store.canUndo(); },
      project: currentProject,
      blocked: function () {
        if (openSheets.length) return true;
        return !!(window.Tour && typeof window.Tour.isRunning === 'function' && window.Tour.isRunning());
      },
      wake: ctx.wake,
      host: host
    };
  }

  /** The counter's working mode: one engine session on #screen-project. */
  function ensureWorkSession() {
    if (work.session) return work.session;
    if (!els.project || !window.WorkMode || typeof window.WorkMode.create !== 'function') return null;
    work.session = window.WorkMode.create(els.project, {
      label: 'Working mode',
      backTo: 'the counter',
      hudId: 'work-hud',
      panelId: 'work-panel',
      adopt: true,
      tip: 'Tap anywhere to count · swipe to turn',
      rectNode: function () { return els.stitchBtn; },
      build: buildWorkStack,
      paint: function () {
        var p = currentProject();
        paintWorkHud(p, p ? Store.activePart(p) : null);
      },
      primary: { label: 'Count a stitch', run: function () { doStitchTap(); } },
      forward: {
        label: 'Complete row', glyph: '+', word: 'Row', cls: 'work-row-plus',
        run: function () { clickCounter(document.getElementById('row-plus')); }
      },
      back: {
        label: 'Previous row', glyph: '−', cls: 'work-row-minus',
        run: function () { clickCounter(document.getElementById('row-minus')); }
      },
      undo: {
        label: 'Undo last action', cls: 'work-undo',
        run: function () { clickCounter(els.btnUndo); },
        enabled: function () { return Store.canUndo(); }
      },
      secondary: [{
        id: 'stMinus', side: 'start', glyph: '−1', label: 'Remove one stitch', cls: 'work-st-minus',
        run: function () { clickCounter(document.getElementById('stitch-minus')); }
      }],
      panel: function (body) { buildWorkPanel(body); },
      syncPanel: function () { syncWorkPanel(currentProject(), currentPart()); },
      onInsets: function (ins) {
        if (!live.handle || typeof live.handle.setSafeInsets !== 'function') return;
        try { live.handle.setSafeInsets(ins); } catch (e) { /* ignore */ }
      },
      onToggle: function () {
        // the stitch button just changed size: the canvas follows once laid out
        // (mountLiveDiagram resizes at once; this catches the settled layout)
        window.requestAnimationFrame(function () { resizeDiagrams(); });
      },
      say: function () {
        var p = currentProject();
        return workCountSentence(p, p ? Store.activePart(p) : null);
      },
      focusNode: function () { return els.stitchBtn; },
      returnFocus: function () { return document.getElementById('stitch-3d') || els.stitchBtn; }
    }, workEnv(els.project));
    return work.session;
  }

  function openWorkMode() {
    var p = currentProject();
    if (!p) return;
    var s = ensureWorkSession();
    if (s) { s.openUser(); return; }
    // no js/workmode.js (an old cached copy): remember it; the next load has it
    rememberWork(p, true);
    render();
  }

  function closeWorkMode() {
    var s = ensureWorkSession();
    if (s) { s.closeUser(); return; }
    rememberWork(currentProject(), false);
    render();
  }

  /** Called by renderProject before the counters paint: the remembered mode. */
  function syncWorkMode(p) {
    var s = ensureWorkSession();
    if (!s) { work.on = false; return; }
    s.sync(workWanted(p));
    work.on = s.isOn();
    work.n = s.nodes;
    work.hud = document.getElementById('work-hud');
  }

  /** Click one of the counter's own controls, so every rule stays the counter's. */
  function clickCounter(node) {
    if (node && !node.disabled) node.click();
  }

  /** The counter's readout stack inside the engine's HUD (wave I's nodes, unchanged). */
  function buildWorkStack(n) {
    work.n = n;
    var stack = n.stack;
    var read = el('div', 'work-read');
    var rowCell = el('div', 'work-cell work-rowcell');
    n.rowCap = el('div', 'work-cap');
    var rowLine = el('div', 'work-numline');
    n.rowNum = el('span', 'work-big');
    n.rowOf = el('span', 'work-of');
    rowLine.appendChild(n.rowNum);
    rowLine.appendChild(n.rowOf);
    n.rowSub = el('div', 'work-sub');
    n.rowTags = el('div', 'work-tags');
    rowCell.appendChild(n.rowCap);
    rowCell.appendChild(rowLine);
    // "piece 1 of 2" and the RS / WS chip share one line
    var rowMeta = el('div', 'work-meta');
    rowMeta.appendChild(n.rowSub);
    rowMeta.appendChild(n.rowTags);
    rowCell.appendChild(rowMeta);
    var stCell = el('div', 'work-cell work-stcell');
    n.stCell = stCell;
    stCell.appendChild(el('div', 'work-cap', 'STITCHES'));
    var stLine = el('div', 'work-numline');
    n.stNum = el('span', 'work-big');
    n.stOf = el('span', 'work-of');
    stLine.appendChild(n.stNum);
    stLine.appendChild(n.stOf);
    n.stSub = el('div', 'work-sub');
    stCell.appendChild(stLine);
    stCell.appendChild(n.stSub);
    read.appendChild(rowCell);
    read.appendChild(stCell);
    stack.appendChild(read);

    n.line = el('div', 'work-line');
    n.lineTag = el('span', 'work-line-tag');
    var main = el('span', 'work-line-main');
    n.lineText = el('span', 'work-line-text');
    n.lineNotes = el('span', 'work-line-notes');
    main.appendChild(n.lineText);
    main.appendChild(n.lineNotes);
    n.line.appendChild(n.lineTag);
    n.line.appendChild(main);
    stack.appendChild(n.line);

    n.hints = el('div', 'work-hints');
    n.hintBox = {};
    ['setup', 'yarn', 'short', 'extra', 'dev'].forEach(function (k) {
      var h = el('div', 'work-hint');
      h.hidden = true;
      n.hintBox[k] = h;
      n.hints.appendChild(h);
    });
    n.markers = el('div', 'knit-markers work-markers');
    n.markers.hidden = true;
    n.hints.appendChild(n.markers);
    stack.appendChild(n.hints);
    // the engine's corner buttons, under wave I's names
    var b = n.buttons || {};
    n.stMinus = b.stMinus;
    n.undo = b.undo;
    n.rowMinus = b.back;
    n.rowPlus = b.forward;
    work.mirrors = Object.create(null);
    work.nextKey = '';
  }

  /**
   * Copy a counter node's children into a HUD node, once per change. Ids and
   * tour hooks are dropped from the copy, and a copied button clicks the
   * counter's button at the same place (looked up at click time, because the
   * knitting chips are rebuilt on every update).
   */
  function mirrorNode(key, src, dst) {
    var html = src ? src.innerHTML : '';
    if (work.mirrors[key] === html) return;
    work.mirrors[key] = html;
    clear(dst);
    if (!src) return;
    for (var c = src.firstChild; c; c = c.nextSibling) dst.appendChild(c.cloneNode(true));
    Array.prototype.forEach.call(dst.querySelectorAll('[id],[data-tour]'), function (x) {
      x.removeAttribute('id');
      x.removeAttribute('data-tour');
    });
    Array.prototype.forEach.call(dst.querySelectorAll('button'), function (b, i) {
      on(b, 'click', function (e) {
        e.stopPropagation();
        clickCounter(src.querySelectorAll('button')[i]);
      });
    });
  }

  /** A counter node shown as one HUD hint (its class rides along for its colours). */
  function mirrorHint(key, src) {
    var box = work.n.hintBox[key];
    var show = !!(src && !src.hidden && src.parentNode && (src.textContent || '').trim());
    box.hidden = !show;
    if (!show) {
      if (work.mirrors[key] !== '') { work.mirrors[key] = ''; clear(box); }
      return;
    }
    box.className = 'work-hint ' + src.className;
    if (src.getAttribute('aria-label')) box.setAttribute('aria-label', src.getAttribute('aria-label'));
    else box.removeAttribute('aria-label');
    if (src.getAttribute('role')) box.setAttribute('role', src.getAttribute('role'));
    mirrorNode(key, src, box);
  }

  /** The text nodes of the stitch readout ("Group 2 of 3 · stitch 4 of 10"), without the ≈ why badge. */
  function readoutText() {
    var r = els.stitchReadout;
    if (!r) return '';
    var s = '';
    for (var c = r.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) s += c.nodeValue;
    return s.trim();
  }

  /** "Next · Rnd 5 · 5. Inc, 3sc, repeat around", or "Last round of Body". */
  function paintWorkNext(p, prt, ri, line, finished) {
    var n = work.n;
    var sr = null;
    try { sr = isKnit(p) && typeof Store.shortRowInfo === 'function' ? Store.shortRowInfo(prt) : null; } catch (e) { sr = null; }
    var nextRow = ri.workingRow + 1;
    var key, tag = '', text = '', nline = null, word = rowWordAt(p, prt, ri.workingRow).toLowerCase();
    if (finished || sr) {
      key = 'none';
    } else if (prt.targetRows && nextRow > prt.targetRows) {
      var pieceLeft = prt.makeCount > 1 && prt.piecesDone + 1 < prt.makeCount;
      key = 'last:' + prt.id + ':' + prt.row + ':' + pieceLeft;
      tag = pieceLeft ? 'Then' : 'Last';
      text = pieceLeft
        ? prt.name + ' ' + (prt.piecesDone + 2) + ' of ' + prt.makeCount + ', from ' + shortRowWordAt(p, prt, 1).toLowerCase() + ' 1'
        : 'This is the last ' + word + ' of ' + prt.name;
    } else {
      var nri = Store.repeatInfo({ row: prt.row + 1, repeat: prt.repeat });
      nline = Store.lineForRow(prt, nri.patternRow);
      tag = 'Next · ' + shortRowWordAt(p, prt, nri.patternRow) + ' ' + nri.patternRow;
      key = 'next:' + prt.id + ':' + nri.patternRow + ':' + (nline ? nline.text : '') + ':' + (nline === line);
      if (nline && nline === line) text = 'same as this ' + word;
      else if (!nline) key = 'none';
    }
    if (key === work.nextKey) return;
    work.nextKey = key;
    n.next.hidden = key === 'none';
    if (key === 'none') return;
    n.nextTag.textContent = tag;
    if (nline && nline !== line && nline.text) fillSizeMarked(n.nextText, nline.text, prt, p);
    else n.nextText.textContent = text;
    n.next.setAttribute('aria-label', tag + ': ' + (n.nextText.textContent || ''));
  }

  /** Paint the HUD from the counter (called at the end of updateCounters). */
  function updateWorkHud(p, prt) {
    if (!work.on || !work.session || !p || !prt) return;
    // the engine calls paintWorkHud, then syncs its buttons, the open panel and the insets
    work.session.refresh();
  }

  function paintWorkHud(p, prt) {
    if (!work.on || !p || !prt || !work.n || !work.n.rowCap) return;
    var n = work.n;
    var finished = partFinished(prt);
    var ri = Store.repeatInfo(prt);

    var mate = isKnit(p) && typeof Store.linkedPart === 'function' ? Store.linkedPart(p, prt) : null;
    var name = groupPrefix(p, prt) + (mate && typeof Store.linkedLabel === 'function' ? Store.linkedLabel(p, prt) : prt.name);
    n.title.textContent = name;
    n.title.title = name;

    // rows DONE, as the counter's big number counts them
    var doneWord = rowWordAt(p, prt, Math.max(1, prt.row));
    n.rowCap.textContent = (doneWord + 's done').toUpperCase();
    n.rowNum.textContent = String(prt.row);
    n.rowOf.textContent = prt.targetRows ? '/ ' + (Store.targetApprox(prt) ? '≈ ' : '') + prt.targetRows : '';
    var rowSub = [];
    if (prt.makeCount > 1) rowSub.push('piece ' + Math.min(prt.piecesDone + 1, prt.makeCount) + ' of ' + prt.makeCount);
    if (els.repeat && !els.repeat.hidden && els.repeat.textContent) rowSub.push(els.repeat.textContent);
    n.rowSub.textContent = rowSub.join(' · ');
    n.rowSub.hidden = !rowSub.length;
    // knitting: the RS / WS chip and the cable ring, from the row label
    // ("SHORT ROWS" is not repeated: the short-row strip says "Short row 2 of 14")
    var tagSrc = null;
    if (isKnit(p) && els.rowLabel) {
      tagSrc = document.createElement('div');
      Array.prototype.forEach.call(els.rowLabel.querySelectorAll('.knit-side-chip, .knit-cable'), function (x) {
        tagSrc.appendChild(x.cloneNode(true));
      });
    }
    if (tagSrc && tagSrc.firstChild) {
      n.rowTags.hidden = false;
      var tagHtml = tagSrc.innerHTML;
      if (work.mirrors.rowTags !== tagHtml) {
        work.mirrors.rowTags = tagHtml;
        clear(n.rowTags);
        while (tagSrc.firstChild) n.rowTags.appendChild(tagSrc.firstChild);
        var chip = n.rowTags.querySelector('.knit-side-chip');
        if (chip) {
          chip.removeAttribute('data-tour');
          on(chip, 'click', function (e) {
            e.stopPropagation();
            clickCounter(els.rowLabel.querySelector('.knit-side-chip'));
          });
        }
      }
    } else {
      n.rowTags.hidden = true;
      if (work.mirrors.rowTags) { work.mirrors.rowTags = ''; clear(n.rowTags); }
    }

    // stitches
    var target = Store.currentTarget(prt);
    var line = Store.lineForRow(prt, ri.patternRow);
    var approx = target && Store.isComputed(line) ? '≈ ' : '';
    n.stNum.textContent = String(prt.stitch);
    n.stOf.textContent = target && !finished ? '/ ' + approx + target : '';
    // wave K (P13): say when a tap counts a whole repeat / marker segment
    var tu = knitTapUnits(p, prt);
    n.stSub.textContent = readoutText() + (tu ? ' · tap = ' + knitTapStep(tu, prt.stitch) + ' sts' : '');
    n.stCell.classList.toggle('over', !!(target && prt.stitch > target));

    // the pattern line: the strip's own nodes, so it is the same text
    var lineOn = !!(els.patternLine && !els.patternLine.hidden && !finished);
    n.line.hidden = !lineOn;
    if (lineOn) {
      mirrorNode('tag', els.patternTag, n.lineTag);
      mirrorNode('text', els.patternText, n.lineText);
      var notesOn = !!(els.patternNotes && !els.patternNotes.hidden && els.patternNotes.textContent);
      n.lineNotes.hidden = !notesOn;
      n.lineNotes.textContent = notesOn ? els.patternNotes.textContent : '';
    }

    // the hints: setup, colour change / turn, short rows, knitting chips, deviation
    mirrorHint('setup', els.setupLine);
    mirrorHint('yarn', els.yarnLine);
    mirrorHint('short', knitEls.short);
    mirrorHint('extra', knitEls.extra);
    mirrorHint('dev', els.stitchDev);
    if (isKnit(p)) {
      paintMarkers(n.markers, p, prt, finished);
      n.markers.removeAttribute('data-tour');
    } else {
      n.markers.hidden = true;
    }

    paintWorkNext(p, prt, ri, line, finished);
    n.tip.hidden = finished || prt.stitch > 0;

    // the buttons say what the counter's buttons say
    var headWord = shortRowWordAt(p, prt, ri.workingRow);
    var plus = document.getElementById('row-plus');
    n.rowPlus.setAttribute('aria-label', plus && plus.getAttribute('aria-label') === 'Short row done (turn)'
      ? 'Short row done (turn)' : 'Complete ' + rowWordAt(p, prt, ri.workingRow).toLowerCase());
    var w = n.rowPlus.querySelector('.work-btn-word');
    if (w) w.textContent = headWord;
    n.rowMinus.setAttribute('aria-label', 'Previous ' + rowWordAt(p, prt, Math.max(1, prt.row)).toLowerCase());
    // Undo's enabled state, the open panel and the insets: the engine's refresh
  }

  /* ---- the folded chips: worked in, way up, terms, turn, and the sheets ---- */

  function setWorkPanel(open) {
    if (work.session) work.session.setPanel(open);
  }

  function workPanelRow(label, node, hint) {
    var row = el('div', 'work-panel-row');
    row.appendChild(el('span', 'work-panel-label', label));
    row.appendChild(node);
    if (hint) row.appendChild(hint);
    return row;
  }

  function buildWorkPanel(panel) {
    var p = currentProject();
    var prt = p ? Store.activePart(p) : null;
    panel = panel || work.n.panel;
    clear(panel);
    work.segs = {};
    if (!p || !prt) return;
    var segs = work.segs;

    var sum = shapeSummary(currentModel());
    if (sum) {
      var shape = el('div', 'work-shape');
      shape.appendChild(el('span', 'work-shape-name', sum.name));
      if (sum.detail) shape.appendChild(el('span', 'work-shape-sub', sum.detail));
      panel.appendChild(shape);
    }

    function changed() {
      pushDiagram('none');
      render();
      fb('tap');
    }
    segs.mode = segmented(
      [{ id: 'auto', label: 'Auto' }, { id: 'rounds', label: 'Rounds' }, { id: 'rows', label: 'Rows' }],
      prt.workMode === 'rounds' || prt.workMode === 'rows' ? prt.workMode : 'auto',
      function (v) {
        var cp = currentPart();
        if (cp) Store.updatePart(p.id, cp.id, { workMode: v });
        changed();
      }
    );
    segs.mode.node.setAttribute('aria-label', 'Worked in rounds or rows');
    panel.appendChild(workPanelRow('Worked in', segs.mode.node));

    segs.orientHint = el('div', 'work-panel-hint', orientationHint(partOrientation(prt), prt));
    segs.orient = segmented(ORIENT_OPTIONS, partOrientation(prt), function (v) {
      var cp = currentPart();
      if (cp) Store.updatePart(p.id, cp.id, { orientation: v });
      changed();
    });
    segs.orient.node.setAttribute('aria-label', 'Worked top-down or bottom-up');
    panel.appendChild(workPanelRow('Way up', segs.orient.node, segs.orientHint));

    // UK / US names are crochet's question, not knitting's (as in the viewer)
    if (!isKnit(p)) {
      segs.dialectHint = el('div', 'work-panel-hint', dialectHint(partDialectPick(prt), prt, true));
      segs.dialect = segmented(DIALECT_OPTIONS, partDialectPick(prt), function (v) {
        var cp = currentPart();
        if (cp) Store.updatePart(p.id, cp.id, { dialect: v });
        changed();
      });
      segs.dialect.node.setAttribute('aria-label', 'Stitch terms: UK or US');
      panel.appendChild(workPanelRow('Terms', segs.dialect.node, segs.dialectHint));
    }

    // the same setting as Settings → "3D follows your stitches" and the viewer's ↻
    segs.follow = segmented(
      [{ id: 'on', label: 'Follows stitches' }, { id: 'off', label: 'Free spin' }],
      diagramFollowOn() ? 'on' : 'off',
      function (v) {
        setDiagramFollow(v === 'on');
        fb('tap');
      }
    );
    segs.follow.node.setAttribute('aria-label', 'The 3D piece turns with each stitch, or spins freely');
    panel.appendChild(workPanelRow('Turn', segs.follow.node));

    var acts = el('div', 'work-actions');
    if (wakeSupported) {
      segs.awake = button('btn work-awake', '☀ Keep awake', 'Keep screen awake');
      on(segs.awake, 'click', function () {
        clickCounter(els.btnWake);
        syncWorkPanel(currentProject(), currentPart());
      });
      acts.appendChild(segs.awake);
    }
    var pat = button('btn', '📖 Pattern', 'Open the whole pattern');
    on(pat, 'click', function () {
      var cp = currentPart();
      setWorkPanel(false);
      if (cp) openPatternSheet(p.id, cp.id);
    });
    acts.appendChild(pat);
    var yarn = button('btn', '🎨 Yarn colours', 'Yarn colours');
    on(yarn, 'click', function () {
      setWorkPanel(false);
      openYarnSheet(p.id);
    });
    acts.appendChild(yarn);
    if (diagramAvailable()) {
      var whole = button('btn', '🔍 Whole piece', 'Look at the whole piece: drag to turn, pinch to zoom');
      on(whole, 'click', function () {
        setWorkPanel(false);
        openViewerSheet();
      });
      acts.appendChild(whole);
    }
    panel.appendChild(acts);
    syncWorkPanel(p, prt);
  }

  /** Keep the open panel's chips in step with the Store (an Undo moves them too). */
  function syncWorkPanel(p, prt) {
    var segs = work.segs;
    if (!workPanelIsOpen() || !prt) return;
    if (segs.mode) segs.mode.set(prt.workMode === 'rounds' || prt.workMode === 'rows' ? prt.workMode : 'auto');
    if (segs.orient) {
      segs.orient.set(partOrientation(prt));
      segs.orientHint.textContent = orientationHint(partOrientation(prt), prt);
    }
    if (segs.dialect) {
      segs.dialect.set(partDialectPick(prt));
      segs.dialectHint.textContent = dialectHint(partDialectPick(prt), prt, true);
    }
    if (segs.follow) segs.follow.set(diagramFollowOn() ? 'on' : 'off');
    if (segs.awake) {
      var awake = !!Store.settings().keepAwake;
      segs.awake.classList.toggle('on', awake);
      segs.awake.setAttribute('aria-pressed', awake ? 'true' : 'false');
    }
  }

  /**
   * Keyboard in working mode: Space / Enter count a stitch, the arrows move
   * the row (up / right complete one, down / left step back), Escape folds
   * the chips or closes the mode. Never while a sheet or a tour is up, never
   * from a text field, and never on top of a control's own Enter / Space.
   */
  function bindWorkKeys() {
    // Wave K: js/workmode.js holds the one keydown listener for every session
    // (Space / Enter, the arrows, PageDown / PageUp for a page-turner pedal,
    // Escape), with the same guards: no sheet, no tour, no text field.
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
      subject: projectId,
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

  /* The synthetic "From this PDF" card in the New project template picker.
     It is never a real template id — on save it becomes 'blank'. */
  var PDF_TEMPLATE_ID = '__pdf__';

  function templatePreview(tpl) {
    return sectionsPreview(tpl.parts);
  }

  /**
   * "Body, Wings ×2" - and, wave G, for a booklet of sizes every size by name:
   * "Keyring: Body, Wings ×2 · Medium: Body, Wings ×2 · Big: …".
   */
  function sectionsPreview(parts) {
    var label = function (s) { return (s.name || 'Part') + (s.makeCount > 1 ? ' ×' + s.makeCount : ''); };
    var order = [], by = {}, shared = [];
    (parts || []).forEach(function (s) {
      if (!s.group) { shared.push(label(s)); return; }
      if (!by[s.group]) { by[s.group] = []; order.push(s.group); }
      by[s.group].push(label(s));
    });
    if (!order.length) return shared.join(', ');
    var out = order.map(function (g) { return g + ': ' + by[g].join(', '); });
    if (shared.length) out.unshift(shared.join(', '));
    return out.join(' · ');
  }

  function openProjectEditor(projectId) {
    var editing = !!projectId;
    var p = editing ? Store.project(projectId) : null;
    if (editing && !p) return;

    var chosenTemplate = 'blank';
    var chosenCraft = p ? p.craft || 'crochet' : 'crochet';
    var nameInput, notesArea, emoji, modeSeg, groupStep;
    var modeField, groupField, craftFieldsWrap, craftFieldsApi, pdfWrap;
    var craftPdfWrap = null;
    var craftZone = null;
    var sheetApi = null;
    var pdf = null;

    /* Rows/Rounds and the stitch group size only mean something to crochet
       (and, wave H, to a counter craft such as knitting). */
    function syncCraftOnlyFields() {
      var crochet = counterCraft(chosenCraft);
      if (modeField) modeField.hidden = !crochet;
      if (groupField) groupField.hidden = !crochet;
      // The crochet PDF block (sections, "From this PDF", save as template)
      // is crochet's; another craft gets its own importer's drop zone below.
      if (pdfWrap) pdfWrap.hidden = !crochet;
      mountCraftPdf();
    }

    /** What the Save button would create, as a patch for Store.createProject. */
    function newProjectPatch(fallbackName) {
      var patch = {
        name: nameInput.value,
        emoji: emoji.get(),
        countMode: modeSeg.get(),
        groupSize: groupStep.get(),
        notes: notesArea.value
      };
      if (!patch.name.trim() && fallbackName) patch.name = fallbackName;
      patch.templateId = chosenTemplate === PDF_TEMPLATE_ID ? 'blank' : chosenTemplate;
      patch.craft = chosenCraft;
      // Whatever the craft's own new-project fields collected.
      var seed = null;
      if (craftFieldsApi && typeof craftFieldsApi.get === 'function') {
        try { seed = craftFieldsApi.get(); } catch (e) { seed = null; }
      }
      patch.craftData = seed && typeof seed === 'object' ? seed : {};
      return patch;
    }

    /**
     * Wave E (cross-stitch audit): the New project drop zone for a craft other
     * than crochet. It catches the file without reading it, creates the
     * project from the sheet as Save would, and hands the file to that craft's
     * own importer — `def.openImportSheet`, the very sheet ⋯ → Import pattern
     * opens — so its preview and its confirm step are the ones shown. Before
     * this, a cross-stitch or sewing project could only get its PDF after it
     * had been created, through the ⋯ menu.
     */
    function mountCraftPdf() {
      if (!craftPdfWrap) return;
      if (craftZone && craftZone.destroy) craftZone.destroy();
      craftZone = null;
      clear(craftPdfWrap);
      var def = counterCraft(chosenCraft) ? null : craftDefs[chosenCraft];
      craftPdfWrap.hidden = !(def && typeof def.openImportSheet === 'function');
      if (craftPdfWrap.hidden) return;
      var accept = Array.isArray(def.importAccept) && def.importAccept.length ? def.importAccept : ['.pdf'];
      var extra = accept.filter(function (a) { return a !== '.pdf' && a !== '.xml'; });
      var info = craftInfo(chosenCraft);
      craftZone = pdfDropZone({
        accept: accept,
        icon: info.emoji,
        ariaLabel: 'Choose a ' + info.name.toLowerCase() + ' pattern file',
        // wave K: the craft's own words ("…or a picture of a chart"), else the extensions
        label: craftCopy(chosenCraft, 'dropLabel') || ('Drop a ' + info.name.toLowerCase() + ' PDF' +
          (extra.length ? ' or ' + extra.join(' / ') + ' file' : '') + ' here, or choose a file'),
        rejectMessage: 'That needs to be a PDF' + (extra.length ? ' or ' + extra.join(' / ') : ''),
        handOff: function (file) {
          var base = String(file.name || '').replace(/\.[a-z0-9]+$/i, '').trim();
          var created = Store.createProject(newProjectPatch(base));
          Store.setActiveProject(created.id);
          if (sheetApi) sheetApi.close();
          render();
          importFileIntoCraft(def, created.id, file);
        }
      });
      craftPdfWrap.appendChild(craftZone);
      craftPdfWrap.appendChild(
        el('p', 'muted craft-pdf-hint', 'The project is made from this sheet, then the ' +
          info.name.toLowerCase() + ' importer reads the file and shows you what it found before anything is saved into it.')
      );
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
      subject: editing ? projectId : null,
      title: editing ? 'Edit project' : 'New project',
      build: function (body, api) {
        sheetApi = api;
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
                // wave H: a text already read is re-read by the new craft's parser
                if (pdf && pdf.recraft) pdf.recraft();
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

            // A PDF has been read: the sections it found are offered as a
            // synthetic template at the front, and picked by default. Any real
            // template can still be chosen — the sections are then added on top
            // of that template's parts.
            var pdfSecs = pdf && counterCraft(chosenCraft) ? pdf.checkedSections() : [];
            if (pdfSecs.length) {
              var pdfCard = button('tpl-card' + (chosenTemplate === PDF_TEMPLATE_ID ? ' on' : ''));
              pdfCard.setAttribute('data-tour', 'new-pdf-card');
              pdfCard.appendChild(el('span', 'tpl-emoji', '📄'));
              var pdfMain = el('div', 'tpl-main');
              pdfMain.appendChild(el('div', 'tpl-name', pdf.sourceLabel()));
              pdfMain.appendChild(el('div', 'tpl-parts', sectionsPreview(pdfSecs)));
              pdfCard.appendChild(pdfMain);
              on(pdfCard, 'click', function () {
                chosenTemplate = PDF_TEMPLATE_ID;
                Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove('on'); });
                pdfCard.classList.add('on');
              });
              grid.appendChild(pdfCard);
            } else if (chosenTemplate === PDF_TEMPLATE_ID) {
              // Every section was unticked (or the craft changed) — fall back.
              chosenTemplate = 'blank';
            }

            // The chosen template may have just been deleted in the editor, or
            // belong to the craft we just switched away from.
            var chosen = chosenTemplate === PDF_TEMPLATE_ID ? null : Store.template(chosenTemplate);
            if (chosenTemplate !== PDF_TEMPLATE_ID && (!chosen || (chosen.craft || 'crochet') !== chosenCraft)) {
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
                if (pdf) pdf.rerender();
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

          // Import a PDF while creating the project, rather than making the
          // project first and importing afterwards.
          pdfWrap = el('div', 'new-pdf');
          pdf = newProjectPdfBlock(
            pdfWrap,
            nameInput,
            renderTemplatePicker,
            function () {
              chosenTemplate = PDF_TEMPLATE_ID;
              renderTemplatePicker();
            },
            function () { return modeSeg ? rowWord({ countMode: modeSeg.get() }) : 'Row'; },
            function () { return chosenCraft; }
          );
          body.appendChild(pdfWrap);

          // Cross-stitch / sewing: the craft's own importer, fed from here.
          craftPdfWrap = el('div', 'new-pdf new-craft-pdf');
          craftPdfWrap.hidden = true;
          body.appendChild(craftPdfWrap);
        }

        modeSeg = segmented(
          [{ id: 'rows', label: 'Rows' }, { id: 'rounds', label: 'Rounds' }],
          p ? p.countMode : 'rows',
          // "20 rounds" / "20 rows" in the sections list follows this segment.
          function () { if (pdf) pdf.rerender(); }
        );
        modeField = field('Count', modeSeg.node);
        body.appendChild(modeField);

        groupStep = stepper(p ? p.groupSize : 10, 0, 50, 'group size');
        groupField =
          field('Stitch group size', groupStep.node, 'A buzz every few stitches while you count. Set it to 0 to turn grouping off.');
        body.appendChild(groupField);

        // Craft-specific new-project fields go here.
        if (!editing) {
          craftFieldsWrap = el('div', 'craft-fields');
          body.appendChild(craftFieldsWrap);
          mountCraftFields();
        }

        notesArea = textArea(p ? p.notes : '', '', 'Hook 4mm · Paintbox DK · pattern link…');
        body.appendChild(field('Notes', notesArea));

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
      onClose: function () {
        // The drop zone hangs a document-level guard on dragover/drop.
        if (pdf) pdf.destroy();
        pdf = null;
        if (craftZone && craftZone.destroy) craftZone.destroy();
        craftZone = null;
        sheetApi = null;
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save',
          cls: 'btn primary',
          onClick: function saveNewProject(api) {
            var patch = {
              name: nameInput.value,
              emoji: emoji.get(),
              countMode: modeSeg.get(),
              groupSize: groupStep.get(),
              notes: notesArea.value
            };
            if (editing) {
              Store.updateProject(p.id, patch);
              api.close();
              render();
              return;
            }

            // A PDF read in this sheet: its sections become parts right after
            // the project exists, on top of whatever the template made.
            var secs = pdf && counterCraft(chosenCraft) ? pdf.checkedSections() : [];
            // Wave F (03 #1): a multi-size pattern is read at the size picked
            // here, so it is picked before anything is made.
            if (secs.length && pdf.needsSize && pdf.needsSize()) {
              toast('Pick your size first');
              pdf.focusSize();
              return;
            }
            // wave K (BUILD.md): counts that disagree with the pattern in many
            // places ask once before the parts are made; never a block
            var pdfCheck = secs.length && pdf.check ? pdf.check() : null;
            if (pdfCheck && pdfCheck.verdict === 'off' && !api.__checked && window.CheckSheet) {
              window.CheckSheet.guard(pdfCheck, confirmSheet, { confirmText: 'Create it anyway' }).then(function (go) {
                if (!go) return;
                api.__checked = true;
                saveNewProject(api);
              });
              return;
            }
            // wave H (knit-qa-2): one pattern out of a book is named after it
            // ("Plain Socks For A Go-Go Guy", not "Single piece" / the file)
            var bookPattern = secs.length && pdf.patternName ? pdf.patternName() : null;
            if (!patch.name.trim() && bookPattern) patch.name = bookPattern;
            // wave K (knit-audit 4): a knitting pattern is named by its own title, else a tidy file name
            if (!patch.name.trim() && secs.length && chosenCraft === KNIT_ID) patch.name = knitProjectName(pdf.text(), pdf.fileBase());
            if (!patch.name.trim() && secs.length && pdf.fileBase()) patch.name = pdf.fileBase();
            patch.templateId = chosenTemplate === PDF_TEMPLATE_ID ? 'blank' : chosenTemplate;
            patch.craft = chosenCraft;
            // Whatever the craft's own new-project fields collected.
            var seed = null;
            if (craftFieldsApi && typeof craftFieldsApi.get === 'function') {
              try { seed = craftFieldsApi.get(); } catch (e) { seed = null; }
            }
            patch.craftData = seed && typeof seed === 'object' ? seed : {};
            var created = Store.createProject(patch);
            Store.setActiveProject(created.id);

            var bits = [];
            var importRes = null;
            if (secs.length) {
              var res = Store.importPatternSections(created.id, secs, {
                mode: 'parts', text: pdf.importText ? pdf.importText() : pdf.text(), noTargets: pdf.noTargets(),
                size: pdf.size ? pdf.size() : null
              });
              importRes = res;
              var pairsN = applyBothAtOnce(created.id, pdf.bothAtOnce ? pdf.bothAtOnce() : []);   // wave K (P8)
              if (pairsN) bits.push(pairsN === 1 ? 'a pair knit both at once' : pairsN + ' pairs knit both at once');
              var extra = addChecklistItems(created.id, pdf.checkedChecklist());
              knitAttachCharts(created.id, pdf.bookPages ? pdf.bookPages() : null);   // wave H: the PDF's chart pages
              knitKeepMaterials(created.id, pdf.text(), pdf.bookPick ? pdf.bookPick() : null);   // wave K (P20)
              var fresh = Store.project(created.id);
              bits.push(plural(fresh ? fresh.parts.length : secs.length, 'part'));
              if (res && res.sizeSet) bits.push('size ' + res.sizeSet);
              if (res && res.placed) bits.push('placing notes');
              if (extra) bits.push(plural(extra, 'checklist item'));
              if (pdf.wantsTemplate()) {
                /* Wave E: the template is what the import MADE, not what went
                   into it. The project's word after the import (it flips a
                   rows project to rounds when every section is worked in
                   rounds — the panda's template used to say "Row"), and each
                   part's readings — above all the dialect the importer lends
                   from the abbreviations page (the Stylecraft motif's own text
                   says only tr/dc/ch, so a project made from its template read
                   UK trebles as US ones). Matched on the text the part got. */
                var madeParts = fresh ? fresh.parts : [];
                var madeFor = function (s) {
                  for (var k = 0; k < madeParts.length; k++) {
                    if (madeParts[k].patternText === s.text) return madeParts[k];
                  }
                  return null;
                };
                try {
                  Store.saveTemplate({
                    name: pdf.templateName(),
                    emoji: patch.emoji,
                    countMode: fresh ? fresh.countMode : patch.countMode,
                    groupSize: patch.groupSize,
                    craft: chosenCraft,
                    parts: secs.map(function (s) {
                      var made = madeFor(s);
                      var tp = {
                        name: s.name || 'Part',
                        makeCount: s.makeCount,
                        patternText: s.text,
                        placementNotes: s.placement || '',
                        workMode: made ? made.workMode : 'auto',
                        orientation: made ? made.orientation : 'auto',
                        dialect: made ? made.dialect : 'auto'
                      };
                      // wave G: every size the import kept, each part in its own
                      if (s.group) tp.group = s.group;
                      return tp;
                    }),
                    groups: fresh && fresh.groups && fresh.groups.length ? fresh.groups : undefined,
                    checklist: pdf.checkedChecklist(),
                    // wave F: the leaflet's size names + the size picked here
                    sizes: fresh && fresh.sizes ? fresh.sizes : undefined,
                    size: fresh && fresh.size ? fresh.size : undefined
                  });
                  bits.push('saved as template');
                } catch (e) {
                  toast(e && e.message ? e.message : 'That template could not be saved');
                }
              }
            }

            api.close();
            render();
            if (bits.length) {
              toast('Created ' + created.name + ' · ' + bits.join(' · '), { ms: 3600 });
            }
            modeFlipToast(importRes);
            offerCraftTour(chosenCraft);
          }
        }
      ]
    });
  }

  /**
   * The "import a PDF while creating the project" block of the New project
   * sheet: drop zone → sections + checklist (the shared picker) → "Also save as
   * a template". Everything below the drop zone stays hidden until a PDF has
   * actually been read, so the sheet is no longer than it was.
   *
   * @param {HTMLElement} host      where to build it
   * @param {HTMLInputElement} nameInput  the project name field (placeholder + template name)
   * @param {Function} onChange     re-render the template picker
   * @param {Function} onRead       a PDF was read: pick "From this PDF"
   * @param {Function} rowWordFn    'Row' or 'Round', read fresh on every render
   */
  function newProjectPdfBlock(host, nameInput, onChange, onRead, rowWordFn, craftFn) {
    var fileBase = '';
    var tplTouched = false;
    var picker, tplField, tplName, wantsTemplate = false;

    function defaultTemplateName() {
      var base = (nameInput && nameInput.value.trim()) || fileBase || 'Pattern';
      return base + ' template';
    }

    function syncTemplateName() {
      if (!tplName || tplTouched) return;
      tplName.value = defaultTemplateName();
    }

    function refreshExtras() {
      var any = picker ? picker.checkedSections().length > 0 : false;
      if (tplField) tplField.hidden = !any;
      if (onChange) onChange();
    }

    // wave H: a knitting PDF's chart pages are kept too (knitZoneOpts)
    var dropZone = pdfDropZone(knitZoneOpts({
      tour: 'new-pdf',
      ariaLabel: 'Choose a pattern PDF',
      label: 'Drop a pattern PDF here, or choose a file',
      confirm: function (file) {
        // Remembered here because onText never sees the file itself.
        fileBase = String((file && file.name) || '').replace(/\.pdf$/i, '').trim();
        return true;
      },
      onText: function (res) {
        area.value = res.text;
        picker.setText(res.text);
        if (nameInput && !nameInput.value.trim() && fileBase) nameInput.placeholder = fileBase;
        syncTemplateName();
        if (picker.checkedSections().length && onRead) onRead();
        refreshExtras();
        announce('Read ' + plural(res.pages, 'page') + ' from the PDF');
      }
    }, function () { return typeof craftFn === 'function' ? craftFn() : 'crochet'; }));
    host.appendChild(dropZone);

    /* The paste route, folded away so the sheet stays short. */
    var pasteRow = el('div', 'tpl-edit-link');
    var pasteLink = button('linkish', 'or paste pattern text');
    pasteLink.setAttribute('aria-expanded', 'false');
    pasteRow.appendChild(pasteLink);
    host.appendChild(pasteRow);

    var area = textArea('', 'mono', 'Paste the instructions from your PDF');
    area.setAttribute('aria-label', 'Pattern text to import');
    var pasteField = field('Pattern text', area);
    pasteField.hidden = true;
    host.appendChild(pasteField);

    on(pasteLink, 'click', function () {
      var show = pasteField.hidden;
      pasteField.hidden = !show;
      pasteLink.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (show) area.focus();
    });

    picker = importPicker({
      // The sheet's own Count segment decides whether these are rows or rounds.
      rowWord: typeof rowWordFn === 'function' ? rowWordFn : 'row',
      hideWhenEmpty: true,
      sectionsHint: 'Each ticked section becomes a part of the new project.',
      // wave H: the craft picked above decides which parser reads the text
      craft: typeof craftFn === 'function' ? craftFn : null,
      onChange: refreshExtras
    });
    host.appendChild(picker.node);

    on(area, 'input', debounce(function () {
      picker.setText(area.value);
      syncTemplateName();
    }, 200));

    /* "Also save as a template" */
    var tplWrap = el('div', 'new-pdf-tpl');
    tplWrap.appendChild(
      switchRow('Also save as a template', 'Keep these parts and their pattern for next time', false, function (on_) {
        wantsTemplate = on_;
        if (tplName) tplName.disabled = !on_;
      })
    );
    tplName = textInput(defaultTemplateName(), 'Panda template');
    tplName.disabled = true;
    tplName.setAttribute('aria-label', 'Template name');
    on(tplName, 'input', function () { tplTouched = true; });
    tplWrap.appendChild(tplName);
    tplField = field(null, tplWrap);
    tplField.hidden = true;
    host.appendChild(tplField);

    if (nameInput) {
      on(nameInput, 'input', syncTemplateName);
    }

    return {
      text: function () { return picker.getText(); },
      fileBase: function () { return fileBase; },
      /** wave H (knit-qa-2): the one pattern of a book being imported, else null */
      patternName: function () { return picker.patternName ? picker.patternName() : null; },
      /** Pasted text gets the same card, under an honest name. */
      sourceLabel: function () { return fileBase ? 'From this PDF' : 'From this pattern'; },
      rerender: function () { picker.rerender(); },
      /** wave H: the craft changed — read the same text again with its parser */
      recraft: function () { if (picker.getText()) picker.setText(picker.getText()); },
      noTargets: picker.noTargets,
      // wave F: size-once
      size: picker.size,
      needsSize: picker.needsSize,
      focusSize: picker.focusSize,
      checkedSections: picker.checkedSections,
      checkedChecklist: picker.checkedChecklist,
      // wave K (E12): the picked book pattern's pages, for its charts only
      bookPages: function () { return picker.bookPages ? picker.bookPages() : null; },
      bookPick: function () { return picker.bookPick ? picker.bookPick() : null; },
      // wave K: the ticked sections' Check (the Save guard asks when it is "off")
      check: function () { return picker.check ? picker.check() : null; },
      importText: function () { return picker.importText ? picker.importText() : picker.getText(); },
      bothAtOnce: function () { return picker.bothAtOnce ? picker.bothAtOnce() : []; },
      wantsTemplate: function () { return wantsTemplate; },
      templateName: function () {
        return (tplName && tplName.value.trim()) || defaultTemplateName();
      },
      destroy: function () {
        if (dropZone) dropZone.destroy();
        if (picker) picker.destroy();
      }
    };
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
    toast('Deleted “' + name + '”', {
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
      subject: projectId,
      title: 'Add a part',
      build: function (body) {
        nameInput = textInput('', (Store.project(projectId) || {}).craft === 'knitting' ? 'Sleeve' : 'Wing');
        body.appendChild(field('Name', nameInput));
        countStep = stepper(1, 1, 20, 'make count');
        var knitP = (Store.project(projectId) || {}).craft === 'knitting';
        body.appendChild(field('How many', countStep.node, knitP ? 'Sleeves ×2, socks ×2 — the counter tracks each piece.' : 'Wings ×2, legs ×4 — the counter tracks each piece.'));
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
      alertsInput, placeArea, patternArea, extras, modeSeg, syncModeHint,
      orientSeg, syncOrientHint, dialectSeg, syncDialectHint;
    var repeatOn = !!prt.repeat.enabled;
    var sizeIndex = prt.sizeIndex || 0;
    // Wave F (size-once): the Size select sets the PROJECT's size unless
    // "Only this part" is on (it starts on when this part already differs).
    var sizeOnlyThis = !!(p.size && p.size.index !== (prt.sizeIndex || 0));
    var sizeOffered = false;
    // 03 #6: "N times" or "until N rows total".
    var repeatMode = prt.repeat.mode === 'untilRows' ? 'untilRows' : 'times';
    var repModeSeg = null, repUntil = null, repTimesField = null, repUntilField = null;
    var targetTyped = false;
    var knitEditor = null;   // wave H: the Knitting card (gauge, two at a time)

    /** A part-shaped object so the Store can parse the unsaved textarea. */
    function previewPart() {
      return {
        id: prt.id + ':preview', patternText: patternArea.value, sizeIndex: sizeIndex,
        sizeCount: p.sizes && p.sizes.length >= 2 ? p.sizes.length : 0
      };
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
          times: repTimes.value,
          mode: repeatMode,
          untilRows: repUntil && repUntil.value !== '' ? repUntil.value : null
        },
        alerts: parseNumberList(alertsInput.value),
        placementNotes: placeArea.value,
        patternText: patternArea.value,
        sizeIndex: sizeIndex,
        workMode: modeSeg ? modeSeg.get() : 'auto',
        orientation: orientSeg ? orientSeg.get() : 'auto',
        dialect: dialectSeg ? dialectSeg.get() : 'auto'
      };
    }

    function syncRepeatSwitch() {
      var sw = repEnable ? repEnable.querySelector('.switch') : null;
      if (sw) sw.setAttribute('aria-checked', repeatOn ? 'true' : 'false');
    }

    function summaryLine(s, tmp) {
      var bits = [];
      if (!s.rows) {
        bits.push('No numbered ' + partRowWord(p, prt).toLowerCase() + 's found yet');
      } else {
        bits.push(
          s.rows + ' ' + partRowWord(p, prt).toLowerCase() + (s.rows === 1 ? '' : 's') +
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
        out.push('Target ' + partRowWord(p, prt).toLowerCase() + 's: ' + sug.targetRows);
      }
      var r = sug.repeat;
      if (r && r.startRow && r.endRow && r.endRow >= r.startRow) {
        out.push(
          'Repeat ' + partRowWord(p, prt).toLowerCase() + 's ' + r.startRow + '–' + r.endRow +
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
        // wave F: "until N rows" comes back as its own mode
        repeatMode = prt.repeat.mode === 'untilRows' ? 'untilRows' : 'times';
        if (repUntil) repUntil.value = prt.repeat.untilRows == null ? '' : String(prt.repeat.untilRows);
        if (repModeSeg && repModeSeg.set) repModeSeg.set(repeatMode);
        if (repTimesField) { repTimesField.hidden = repeatMode === 'untilRows'; repUntilField.hidden = repeatMode !== 'untilRows'; }
        toast('Applied: ' + bits.join(' · '));
      });
    }

    function refreshParsed() {
      // Auto's answer follows the text in the box, so it is re-read here too.
      if (syncModeHint) {
        try { syncModeHint(); } catch (e) { /* ignore */ }
      }
      if (syncOrientHint) {
        try { syncOrientHint(); } catch (e) { /* ignore */ }
      }
      if (syncDialectHint) {
        try { syncDialectHint(); } catch (e) { /* ignore */ }
      }
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
      // Wave F (06 #1 / #8): what the counts rest on, at the size picked.
      var rep = Store.countReport(tmp);
      var conf = countLineText(rep, partRowWord(p, prt), !!prt.makeCountInferred && makeStep && makeStep.get() === prt.makeCount);
      if (conf) {
        var confEl = el('div', 'parsed-note imp-conf' + (rep.disagree.length || rep.unresolved ? ' warn' : ''), conf);
        extras.appendChild(confEl);
        rep.disagree.slice(0, 3).forEach(function (d) {
          extras.appendChild(el('div', 'parsed-note warn',
            partShortRowWord(p, prt) + ' ' + d.row + (d.rowEnd > d.row ? '–' + d.rowEnd : '') +
            ': pattern says ' + d.printed + ' · instructions add up to ' + d.computed));
        });
      }

      /* ---- Size picker (wave F: the PROJECT's size, once) ---- */
      var pickerNames = (p.sizes && p.sizes.length >= 2) ? p.sizes : ((s.sizes && s.sizes.length) ? s.sizes : null);
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
          sel.setAttribute('aria-label', 'Size');
          var sizeWrap = el('div', 'size-pick');
          sizeWrap.appendChild(sel);
          // "Only this part" is the rare "body in L, sleeves in M" case; by
          // default the pick is the project's and moves every part.
          var onlyRow = switchRow('Only this part', 'Leave the other parts at their size', sizeOnlyThis, function (v) {
            sizeOnlyThis = v;
            syncSizeHint();
          });
          sizeWrap.appendChild(onlyRow);
          var sizeHint = el('div', 'field-hint');
          var syncSizeHint = function () {
            var lab = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
            if (sizeOnlyThis) sizeHint.textContent = lab + ' for ' + (nameInput.value || prt.name) + ' only.';
            else if (p.size && p.size.index === sizeIndex) sizeHint.textContent = lab + ' — the project’s size. Every part follows it.';
            else sizeHint.textContent = 'Saving makes ' + lab + ' the project’s size: every part’s counts and targets follow, and progress stays.';
          };
          on(sel, 'change', function () {
            sizeIndex = parseInt(sel.value, 10) || 0;
            refreshParsed();
          });
          var sizeF = field('Size', sizeWrap);
          sizeF.appendChild(sizeHint);
          extras.appendChild(sizeF);
          syncSizeHint();
          sizeOffered = true;
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
      subject: projectId,
      title: 'Part: ' + prt.name,
      build: function (body, api) {
        nameInput = textInput(prt.name, 'Body');
        body.appendChild(field('Name', nameInput));

        makeStep = stepper(prt.makeCount, 1, 20, 'make count');
        body.appendChild(field('How many', makeStep.node));

        /* 05 #2 — rounds vs rows, per piece. The project has one word for the
           whole toy, and a Baphomet imported as 'rows' modelled a tail that
           begins `R1: MR4` as a flat sheet. Auto asks the pattern text first
           and says which way it went, so a wrong guess is one tap from fixed. */
        var modeHint = el('div', 'field-hint');
        modeSeg = segmented(
          [{ id: 'auto', label: 'Auto' }, { id: 'rounds', label: 'Rounds' }, { id: 'rows', label: 'Rows' }],
          prt.workMode === 'rounds' || prt.workMode === 'rows' ? prt.workMode : 'auto',
          function () { syncModeHint(); }
        );
        var modeWrap = el('div', 'field');
        modeWrap.appendChild(el('div', 'field-label', 'Worked in'));
        modeWrap.appendChild(modeSeg.node);
        modeWrap.appendChild(modeHint);
        body.appendChild(modeWrap);

        syncModeHint = function () {
          var pick = modeSeg.get();
          if (pick !== 'auto') {
            modeHint.textContent = pick === 'rounds'
              ? 'Worked in rounds — the 3D piece is a solid of revolution.'
              : 'Worked in rows — the 3D piece is a flat sheet.';
            return;
          }
          var resolved = partMode(p, previewMode());
          modeHint.textContent = 'Auto — this pattern reads as ' + resolved + '.';
        };
        /* what Auto resolves to for the text in the box right now, not for the
           text that was saved */
        function previewMode() {
          var tmp = {};
          for (var k in prt) if (prt.hasOwnProperty(k)) tmp[k] = prt[k];
          tmp.id = prt.id + ':modepreview';
          tmp.workMode = 'auto';
          if (patternArea) tmp.patternText = patternArea.value;
          return tmp;
        }
        syncModeHint();

        /* 3D wave C — which way up, per piece. A Baphomet body whose round 1 is
           its neck is worked from the BOTTOM, and drawing it the other way up
           stood the toy on its head. Auto reads the pattern text and says which
           way it went, so a wrong guess is one tap from fixed. */
        var orientHint = el('div', 'field-hint');
        orientSeg = segmented(ORIENT_OPTIONS, partOrientation(prt), function () {
          syncOrientHint();
        });
        orientSeg.node.setAttribute('aria-label', 'Worked top-down or bottom-up');
        var orientWrap = el('div', 'field');
        orientWrap.appendChild(el('div', 'field-label', 'Orientation'));
        orientWrap.appendChild(orientSeg.node);
        orientWrap.appendChild(orientHint);
        body.appendChild(orientWrap);

        syncOrientHint = function () {
          orientHint.textContent = orientationHint(orientSeg.get(), previewMode());
        };
        syncOrientHint();

        /* Wave E — UK or US stitch names, per piece (`Part.dialect`). The
           importer lends a section the document's answer, but a section the
           document could not decide for had no way to be corrected by hand.
           Saved with the rest of the sheet, so it is one Undo like the two
           above; Auto reads the text in the box, as they do. */
        var dialectHintEl = el('div', 'field-hint');
        dialectSeg = segmented(DIALECT_OPTIONS, partDialectPick(prt), function () {
          syncDialectHint();
        });
        dialectSeg.node.setAttribute('aria-label', 'Stitch terms: UK or US');
        var dialectWrap = el('div', 'field');
        dialectWrap.appendChild(el('div', 'field-label', 'Terms'));
        dialectWrap.appendChild(dialectSeg.node);
        dialectWrap.appendChild(dialectHintEl);
        // wave H: UK / US stitch names are crochet's question, not knitting's
        if (isKnit(p)) dialectWrap.hidden = true;
        body.appendChild(dialectWrap);

        syncDialectHint = function () {
          dialectHintEl.textContent = dialectHint(dialectSeg.get(), previewMode());
        };
        syncDialectHint();

        targetInput = numInput(prt.targetRows == null ? '' : prt.targetRows, 1, 999999, 'e.g. 40');
        on(targetInput, 'input', function () { targetTyped = true; });
        body.appendChild(field('Target ' + partRowWord(p, prt).toLowerCase() + 's', targetInput, 'Leave blank for open-ended.'));

        // wave H: knitting's gauge card, two at a time, markers
        knitEditor = knitEditorCard(p, prt, api, function () { return patternArea; });
        if (knitEditor) body.appendChild(knitEditor.node);

        // Repeat
        var repWrap = el('div', 'field');
        repWrap.appendChild(el('div', 'field-label', 'Repeat section'));
        repEnable = switchRow('Enable repeat', 'Loop a block of rows several times.', repeatOn, function (v) {
          repeatOn = v;
        });
        repWrap.appendChild(repEnable);
        var repRow = el('div', 'row-flex');
        repStart = numInput(prt.repeat.startRow, 1, 999999);
        repStart.placeholder = '5';
        repEnd = numInput(prt.repeat.endRow, 1, 999999);
        repEnd.placeholder = '8';
        repTimes = numInput(prt.repeat.times, 1, 9999);
        repTimes.placeholder = '6';
        repUntil = numInput(prt.repeat.untilRows == null ? '' : prt.repeat.untilRows, 1, 999999);
        repUntil.placeholder = '25';
        repRow.appendChild(field('From', repStart));
        repRow.appendChild(field('To', repEnd));
        repTimesField = field('Times', repTimes);
        repUntilField = field('Total ' + partRowWord(p, prt).toLowerCase() + 's', repUntil);
        repRow.appendChild(repTimesField);
        repRow.appendChild(repUntilField);
        // 03 #6: a garment says "until there are a total of 25 Rows", not
        // "5 times" — and the 25 changes with the size.
        repModeSeg = segmented(
          [{ id: 'times', label: 'N times' }, { id: 'untilRows', label: 'Until N ' + partRowWord(p, prt).toLowerCase() + 's total' }],
          repeatMode,
          function (id) { repeatMode = id; syncRepeatMode(); }
        );
        repModeSeg.node.setAttribute('aria-label', 'Repeat how long');
        repWrap.appendChild(repModeSeg.node);
        repWrap.appendChild(repRow);
        var repHint = el('div', 'field-hint');
        repWrap.appendChild(repHint);
        var syncRepeatMode = function () {
          var until = repeatMode === 'untilRows';
          repTimesField.hidden = until;
          repUntilField.hidden = !until;
          var a = parseInt(repStart.value, 10), b = parseInt(repEnd.value, 10), u = parseInt(repUntil.value, 10);
          if (until && a >= 1 && b >= a && u >= a) {
            var t = Math.max(1, Math.floor((u - a + 1) / (b - a + 1)));
            repHint.textContent = partRowWord(p, prt) + 's ' + a + '–' + b + ' worked ' + t + ' time' + (t === 1 ? '' : 's') +
              ' (' + a + '–' + (a + t * (b - a + 1) - 1) + ')';
          } else {
            repHint.textContent = '';
          }
        };
        on(repUntil, 'input', syncRepeatMode);
        on(repStart, 'input', syncRepeatMode);
        on(repEnd, 'input', syncRepeatMode);
        syncRepeatMode();
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
            savePart(api);
          }
        }
      ]
    });

    /**
     * 13 #9: dropping the make-count clamps `piecesDone` and the finished
     * pieces just vanish. Ask first, with the number in the question.
     */
    function savePart(api) {
      var patch = collectPatch();
      var impact = Store.makeCountImpact(p.id, prt.id, patch.makeCount);
      function commit() {
        // Wave F (size-once): the Size select is the PROJECT's size unless
        // "Only this part" is on. setProjectSize moves every part and their
        // pattern targets first, so the target box only wins if it was typed.
        var projectSize = sizeOffered && !sizeOnlyThis &&
          (!p.size || p.size.index !== sizeIndex || p.parts.some(function (q) { return (q.sizeIndex || 0) !== sizeIndex; }));
        var sizeRes = null;
        if (projectSize) {
          // One undo step: the part's edits and the project's size together.
          if (!targetTyped) delete patch.targetRows;
          var both = Store.updatePartWithProjectSize(p.id, prt.id, patch, sizeIndex);
          if (knitEditor) knitEditor.commit();   // wave H: same Undo
          sizeRes = both ? both.size : null;
          api.close();
          render();
          if (sizeRes) toast('Size ' + sizeRes.label + ' for the whole project' +
            (sizeRes.retargeted ? ' · ' + plural(sizeRes.retargeted, 'target') + ' updated' : ''), { ms: 3200 });
          return;
        } else if (sizeOffered && sizeIndex !== (prt.sizeIndex || 0) && !targetTyped) {
          // this part only: its pattern target follows its own size
          var docN = p.sizes && p.sizes.length >= 2 ? p.sizes.length : 0;
          var was = Store.targetRowsFromText(prt.patternText, prt.sizeIndex || 0, docN);
          var now = Store.targetRowsFromText(patch.patternText, sizeIndex, docN);
          if (now && was !== null && prt.targetRows === was) patch.targetRows = now;
        }
        Store.updatePart(p.id, prt.id, patch);
        if (knitEditor) knitEditor.commit();   // wave H: same Undo
        api.close();
        render();
        if (sizeRes) toast('Size ' + sizeRes.label + ' for the whole project' +
          (sizeRes.retargeted ? ' · ' + plural(sizeRes.retargeted, 'target') + ' updated' : ''), { ms: 3200 });
      }
      if (!impact || impact.piecesLost <= 0) {
        commit();
        return;
      }
      confirmSheet({
        title: 'Lose ' + plural(impact.piecesLost, 'finished piece') + '?',
        message:
          'This part has ' + impact.piecesDone + ' pieces done — drop to ' + impact.makeCount + '? ' +
          'Undo puts them back if you change your mind.',
        confirmText: 'Drop to ' + impact.makeCount,
        danger: true
      }).then(function (ok) {
        if (ok) commit();
      });
    }
  }

  function openPartsSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    openSheet({
      subject: projectId,
      title: 'Parts',
      build: function (body, api) {
        var list = el('div', 'list');
        if (!p.parts.length) list.appendChild(el('p', 'muted', 'No parts yet. Add the first piece below.'));
        // Wave G: a heading per size, the parts of that size under it
        var lastGroup = null;
        var sized = projectGroups(p).length > 0;
        p.parts.forEach(function (prt) {
          if (sized && prt.group && prt.group !== lastGroup) {
            lastGroup = prt.group;
            var gpr = Store.groupProgress(p.id, prt.group);
            list.appendChild(el('h3', 'parts-group-head', prt.group + (gpr && gpr.done ? ' ✓' : '')));
          }
          var item = button('menu-item');
          var main = el('div');
          main.appendChild(el('div', null, prt.name + (prt.makeCount > 1 ? ' ×' + prt.makeCount : '')));
          // The same "5 / 20" the counter's bar shows, in the piece's own word
          // (it used the project's: "Row 5 / 20" for a round piece).
          var sub = partFinished(prt)
            ? 'done ✓'
            : partShortRowWord(p, prt) + ' ' + prt.row + (prt.targetRows ? ' / ' + prt.targetRows : '');
          if (prt.makeCount > 1) sub += ' · ' + prt.piecesDone + ' of ' + prt.makeCount + ' done';
          main.appendChild(el('div', 'toggle-sub', sub));
          // Wave F (06 #1 / #8): what this part's counts rest on.
          var rep = Store.countReport(prt);
          var conf = countLineText(rep, partRowWord(p, prt), !!prt.makeCountInferred);
          if (conf) main.appendChild(el('div', 'toggle-sub part-conf' + (rep.disagree.length || rep.unresolved ? ' warn' : ''), conf));
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

  /** The registered definition for a template's craft (any craft), or null. */
  function templateCraftDef(craft) {
    var id = craft || 'crochet';
    return id === 'crochet' ? null : craftDefs[id] || null;
  }

  function templateSub(tpl) {
    // wave K: a chart or steps craft says what its seed holds (def.template.describe)
    var def = templateCraftDef(tpl.craft);
    if (def && !counterCraft(tpl.craft)) {
      var said = '';
      if (def.template && typeof def.template.describe === 'function') {
        try { said = String(def.template.describe(tpl) || ''); } catch (e) { said = ''; }
      }
      var cb = [];
      if (said) cb.push(said);
      if (tpl.checklist.length) cb.push(plural(tpl.checklist.length, 'checklist item'));
      if (!cb.length) cb.push(tpl.craftData ? 'with its own set-up' : 'name and checklist');
      return cb.join(' · ');
    }
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

  /**
   * Wave K: "＋ New template" asks which craft first when there is more than
   * one (it used to make a crochet template whatever you were making).
   */
  function newTemplateFlow(onSaved) {
    if (!multiCraft()) {
      openTemplateEditor({ onSaved: onSaved });
      return;
    }
    openSheet({
      title: 'New template for…',
      build: function (body, api) {
        var list = el('div', 'list');
        craftList().forEach(function (c) {
          var b = button('menu-item tpl-craft-pick');
          b.setAttribute('data-craft', c.id);
          b.appendChild(el('span', 'menu-icon', c.emoji));
          var main = el('span', 'tpl-item-main');
          main.appendChild(el('span', 'tpl-item-name', c.name));
          if (c.tagline) main.appendChild(el('span', 'tpl-item-sub', c.tagline));
          b.appendChild(main);
          on(b, 'click', function () {
            api.close();
            openTemplateEditor({ craft: c.id, onSaved: onSaved });
          });
          list.appendChild(b);
        });
        body.appendChild(list);
      }
    });
  }

  /** Wave K: ⋯ → Save as template, for every craft (the craft's own seed through Store). */
  function saveProjectAsTemplate(p) {
    var draft = Store.templateFromProject(p.id);
    if (!draft) return;
    // a Store from before wave K: the App-side hook fills the seed itself
    var def = templateCraftDef(p.craft);
    if (draft.craftData === null && def && def.template && typeof def.template.fromProject === 'function' &&
        typeof Store.setCraftHooks !== 'function') {
      try {
        var seed = def.template.fromProject(JSON.parse(JSON.stringify(p)));
        if (seed && seed.craftData) draft.craftData = seed.craftData;
        if (seed && Array.isArray(seed.checklist)) draft.checklist = seed.checklist;
      } catch (e) { /* name and checklist only */ }
    }
    openTemplateEditor({ draft: draft });
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
          newTemplateFlow(function () {
            renderTemplateList(list, onChanged);
            if (onChanged) onChanged();
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
    // wave K: "＋ New template" for another craft starts from the Store's draft
    // for it (the craft's blank seed), docs/wave-k/api/shell-data.md §2
    if (!source && opts.craft && opts.craft !== 'crochet' && typeof Store.templateDraft === 'function') {
      try { source = Store.templateDraft(opts.craft); } catch (e) { source = null; }
      if (source && !source.emoji) source.emoji = craftInfo(opts.craft).emoji;
    }
    if (!source && opts.craft && opts.craft !== 'crochet') {
      source = {
        id: '', name: '', emoji: craftInfo(opts.craft).emoji, countMode: 'rows', groupSize: 10,
        parts: [{ name: 'Main', makeCount: 1 }], checklist: [], builtIn: false, craft: opts.craft, craftData: null
      };
    }
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
        // The pattern text rides along through renames, moves and saves; the
        // editor only ever shows a tag for it and offers to drop it.
        // Wave E: so do the placing notes and the three per-piece readings
        // (Worked in / Orientation / Terms). The editor used to rebuild every
        // part from name + count + text alone, so renaming a template — or
        // saving a project as one, which goes through this sheet — quietly
        // dropped all four, and the next project made from it lost them.
        return {
          name: p.name,
          makeCount: p.makeCount,
          patternText: typeof p.patternText === 'string' ? p.patternText : '',
          placementNotes: typeof p.placementNotes === 'string' ? p.placementNotes : '',
          workMode: p.workMode || 'auto',
          orientation: p.orientation || 'auto',
          dialect: p.dialect || 'auto',
          // wave G: the size a part belongs to rides along too
          group: p.group || null
        };
      }),
      checklist: (source.checklist || []).slice()
    };
    if (!model.parts.length) model.parts.push({ name: '', makeCount: 1, patternText: '' });

    var nameInput, emoji, modeSeg, groupStep, partsWrap, checkWrap;
    var craftFieldsRef = null;   // wave K: def.template.fields(...) → { get() → craftData }
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
          if (!model.parts.length) model.parts.push({ name: '', makeCount: 1, patternText: '' });
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
        // wave G: which size of the booklet this part is
        if (p.group) {
          var sizeTagRow = el('div', 'tpl-part-attach');
          sizeTagRow.appendChild(el('span', 'tpl-tag tpl-size-tag', p.group));
          row.appendChild(sizeTagRow);
        }

        // A part saved from a PDF import carries the instructions with it.
        if (p.patternText) {
          var attach = el('div', 'tpl-part-attach');
          attach.appendChild(el('span', 'tpl-tag', 'Pattern attached'));
          var rows = p.patternText.split('\n').filter(function (l) { return l.trim(); }).length;
          attach.appendChild(el('span', 'tpl-attach-meta', plural(rows, 'line')));
          var drop = button('tpl-mini', '✕', 'Remove the pattern from ' + (p.name || 'part ' + (i + 1)));
          drop.setAttribute('title', 'Remove pattern');
          on(drop, 'click', function () {
            syncModel();
            model.parts[i].patternText = '';
            renderParts();
            toast('Pattern removed from ' + (model.parts[i].name || 'that part'));
          });
          attach.appendChild(drop);
          row.appendChild(attach);
        }

        partsWrap.appendChild(row);
        partRefs.push({ name: nameIn, step: step });
      });

      var add = button('btn block', '＋ Add part');
      on(add, 'click', function () {
        syncModel();
        model.parts.push({ name: '', makeCount: 1, patternText: '' });
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
          field('Stitch group size', groupStep.node, 'New projects start with this group size. Set it to 0 to turn grouping off.');
        body.appendChild(groupField);

        // Rows/Rounds and group size are crochet's (and a counter craft's).
        if (!counterCraft(templateCraft)) {
          modeField.hidden = true;
          groupField.hidden = true;
        }

        partsWrap = el('div', 'tpl-parts-edit');
        var partsField = field('Parts', partsWrap, templateCraft === 'knitting' ? 'Sleeves ×2, socks ×2 — each piece is counted separately.' : 'Wings ×2, legs ×4 — each piece is counted separately.');
        body.appendChild(partsField);
        renderParts();
        // wave K: a chart or steps craft has no parts to edit (its one "Main"
        // part rides along unseen); its own section comes from def.template.fields
        if (!counterCraft(templateCraft)) {
          partsField.hidden = true;
          var tdef = templateCraftDef(templateCraft);
          if (tdef && tdef.template && typeof tdef.template.fields === 'function') {
            var own = el('div', 'tpl-craft-fields');
            own.setAttribute('data-craft-template', templateCraft);
            try {
              craftFieldsRef = tdef.template.fields(own, source, ctx) || null;
            } catch (e) {
              craftFieldsRef = null;
            }
            if (own.firstChild) body.appendChild(own);
          } else if (source.craftData) {
            body.appendChild(el('p', 'field-hint tpl-craft-seed',
              'New projects from this template start with this project’s set-up, without its progress.'));
          }
        }

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
            // wave K: the craft's seed travels (a draft's craftData, or what its fields say)
            var seedData = source && source.craftData !== undefined ? source.craftData : undefined;
            if (craftFieldsRef && typeof craftFieldsRef.get === 'function') {
              try { var got = craftFieldsRef.get(); if (got && typeof got === 'object') seedData = got; } catch (e) { /* keep the seed */ }
            }
            try {
              saved = Store.saveTemplate({
                craftData: seedData,
                id: editingId,
                name: nameInput.value,
                emoji: emoji.get(),
                countMode: modeSeg.get(),
                groupSize: groupStep.get(),
                parts: model.parts,
                checklist: model.checklist,
                craft: templateCraft,
                // wave F: the leaflet's size names and the picked size survive an edit
                sizes: source && source.sizes ? source.sizes : undefined,
                size: source && source.size ? source.size : undefined,
                // wave G: the sizes' order (each part keeps its own size)
                groups: source && source.groups ? source.groups : undefined
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

  function sectionRowInfo(text, seq, size, sizeCount, craft) {
    var sz = typeof size === 'number' && size >= 0 ? size : 0;
    var n = typeof sizeCount === 'number' ? sizeCount : 0;
    // wave H: the probe names its craft, so every Store read below uses that
    // craft's parser (knitting → Knits)
    var crf = craft || 'crochet';
    var probe = { id: 'import:' + seq, patternText: text, sizeIndex: sz, sizeCount: n, craft: crf };
    var s = Store.patternSummary(probe);
    var tgt = typeof Store.targetRowsFromText === 'function' ? Store.targetRowsFromText(text, sz, n, crf) : null;
    probe.targetRows = tgt;
    // Wave E: rounds or rows is the SECTION's own reading, not the project's
    // Count segment — the panda's seven parts were listed as "20 rows" while
    // every line reads "Rnd 1: …" and the import itself flips the project to
    // rounds. Null when the text does not say.
    var mode = null;
    var parser = parserOf(crf);
    if (parser && typeof parser.workMode === 'function') {
      try { mode = parser.workMode(text); } catch (e) { mode = null; }
    }
    return {
      rows: s.rows,
      computedOnly: s.computedOnly,
      hasTargets: s.hasTargets,
      mode: mode === 'rounds' || mode === 'rows' ? mode : null,
      // What Store.importPatternSections will set as targetRows (01 #1) —
      // the Store's own rule, asked directly, so the preview can never quote
      // a different number from the one the part gets.
      target: typeof Store.targetRowsFromText === 'function' ? tgt : contiguousTarget(probe),
      // wave F (03 #5): the target was read off a tape measure (≈)
      approx: !!(tgt && typeof Store.targetApprox === 'function' && Store.targetApprox(probe)),
      // Wave F (06 #1 / #8): printed / computed / disagreeing counts, at the
      // size being previewed.
      report: typeof Store.countReport === 'function' ? Store.countReport(probe) : null
    };
  }

  /** Mirrors Store's own targetRowsFromText so the picker can show it first. */
  function contiguousTarget(probePart) {
    var lines;
    try {
      lines = Store.linesFor(probePart) || [];
    } catch (e) {
      return null;
    }
    var seen = Object.create(null);
    var max = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l || l.kind !== 'row') continue;
      var a = typeof l.row === 'number' && isFinite(l.row) ? Math.floor(l.row) : 0;
      if (a < 1) continue;
      var b = typeof l.rowEnd === 'number' && isFinite(l.rowEnd) && l.rowEnd >= a ? Math.floor(l.rowEnd) : a;
      if (b - a > 9999) continue;
      for (var r = a; r <= b; r++) {
        seen[r] = true;
        if (r > max) max = r;
      }
    }
    if (max < 2) return null;
    for (var k = 1; k <= max; k++) if (!seen[k]) return null;
    return max;
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
    /** "Pages 12–20 had no readable text" (06 #4) — never the word "failed". */
    var emptyLine = el('p', 'dz-result dz-empty muted');
    emptyLine.hidden = true;

    // 06 #6: there was no way to abort an import at all.
    var signal = null;
    /** The signal the last onPages handle was opened with (see readPdf). */
    var handleSignal = null;
    var cancelBtn = button('btn ghost block dz-cancel', 'Cancel');
    cancelBtn.hidden = true;
    on(cancelBtn, 'click', function () {
      if (signal) signal.cancelled = true;
      cancelBtn.disabled = true;
      setBusyText('Stopping…');
    });

    function setBusyText(text) {
      zoneLabel.textContent = text || '';
    }

    function setBusy(text, frac) {
      reading = !!text;
      zone.classList.toggle('busy', reading);
      zone.disabled = reading;
      zoneLabel.textContent = text || '';
      zoneLabel.hidden = !text;
      progress.hidden = !text;
      progressFill.style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + '%';
      cancelBtn.hidden = !(reading && signal);
      if (!reading) cancelBtn.disabled = false;
    }

    /** [12,13,14,17] → "12–14, 17" */
    function pageRanges(nums) {
      var sorted = nums.slice().sort(function (a, b) { return a - b; });
      var out = [];
      var i = 0;
      while (i < sorted.length) {
        var start = sorted[i];
        var end = start;
        while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { i++; end = sorted[i]; }
        out.push(start === end ? String(start) : start + '–' + end);
        i++;
      }
      return out.join(', ');
    }

    function showResult(res) {
      if (!res) return;
      var bits = [];
      // The page cap was used: say what was left out rather than pretending.
      if (res.pagesTotal && res.pagesTotal > res.pages) {
        bits.push(res.pages + ' of ' + res.pagesTotal + ' pages');
      } else {
        bits.push(plural(res.pages, 'page'));
      }
      if (res.columnsDetected) bits.push(plural(res.columnsDetected, 'column') + ' untangled');
      bits.push(Number(res.chars).toLocaleString() + ' characters');
      resultLine.textContent = 'Read ' + bits.join(' · ');
      resultLine.hidden = false;

      var empty = res.emptyPages && res.emptyPages.length ? res.emptyPages : null;
      if (empty) {
        emptyLine.textContent =
          (empty.length === 1 ? 'Page ' : 'Pages ') + pageRanges(empty) +
          (empty.length === 1 ? ' had' : ' had') +
          ' no readable text (they are probably images).';
        emptyLine.hidden = false;
      } else {
        emptyLine.hidden = true;
      }
    }

    function fail(err) {
      setBusy('', 0);
      // The user pressed Cancel: leave everything exactly as it was.
      if (err && err.name === 'AbortError') {
        toast('Import cancelled');
        return;
      }
      if (typeof opts.onError === 'function') {
        try {
          opts.onError(err);
          return;
        } catch (e) {
          /* fall through to the toast */
        }
      }
      toast(pdfFailText(err), { ms: 5200 });
    }

    /**
     * onPages + onText: the WHOLE extract pipeline on the already-open
     * document (HANDOFF 6) — the cross-page running-head pass, unicode
     * folding, emptyPages, garbled and ocrNoise, exactly what `onText` alone
     * gets from PdfText.extract. `allowEmpty`: a scanned chart has no text
     * but its page images are still worth having, so the caller is handed an
     * empty result rather than an error.
     */
    function gatherText(handle, readOpts, mySignal) {
      handle.extract({
        signal: mySignal,
        maxPages: readOpts.maxPages || 0,
        allowEmpty: true,
        onProgress: function (page, total) {
          setBusy('Reading page ' + page + ' of ' + total + '…', total ? page / total : 0);
        }
      }).then(function (res) {
        if (signal === mySignal) signal = null;
        setBusy('', 0);
        showResult(res);
        try { opts.onText(res); } catch (e) { fail(e); }
      }, function (err) {
        if (signal === mySignal) signal = null;
        fail(err);
      });
    }

    function readPdf(file, readOpts) {
      readOpts = readOpts || {};
      var mySignal = { cancelled: false };
      signal = mySignal;
      setBusy('Reading page 1…', 0.02);
      if (typeof opts.onPages === 'function') {
        // The signal goes into open() itself (HANDOFF 14): Cancel during the
        // file read or the parse stops it there, and the handle refuses every
        // later call made under a cancelled signal.
        window.PdfText.open(file, { signal: mySignal }).then(function (handle) {
          if (mySignal.cancelled) {
            try { handle.destroy(); } catch (e) { /* already gone */ }
            var abort = new Error('Cancelled');
            abort.name = 'AbortError';
            throw abort;
          }
          // The handle stays bound to this zone's signal for its whole life:
          // every handle.renderPage() honours it between steps and at the
          // pdf.js render task, so wrap.cancel() (or Cancel while reading)
          // stops a page mid-draw, not after it.
          handleSignal = mySignal;
          try {
            opts.onPages(handle);
          } catch (e) {
            fail(e);
            return;
          }
          if (typeof opts.onText === 'function') {
            gatherText(handle, readOpts, mySignal);
          } else {
            signal = null;
            setBusy('', 0);
          }
        }).then(null, function (err) {
          if (signal === mySignal) signal = null;
          fail(err);
        });
        return;
      }
      window.PdfText.extract(file, {
        maxPages: readOpts.maxPages || 0,
        signal: signal,
        onProgress: function (page, total) {
          setBusy('Reading page ' + page + ' of ' + total + '…', total ? page / total : 0);
        }
      }).then(function (res) {
        signal = null;
        setBusy('', 0);
        showResult(res);
        if (typeof opts.onText === 'function') {
          try { opts.onText(res); } catch (e) { fail(e); }
        }
      }, function (err) {
        signal = null;
        fail(err);
      });
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
      // `handOff`: this zone only CATCHES the file and passes it on unread —
      // the New project sheet for a craft whose own importer reads it.
      if (typeof opts.handOff === 'function') {
        if (!isPdf && !matchesAccept(file)) {
          toast(opts.rejectMessage || (accept.length === 1 && wantsPdf ? 'That isn’t a PDF' : 'That file type isn’t supported'));
          return;
        }
        try { opts.handOff(file); } catch (e) { fail(e); }
        return;
      }
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
      // Three gates, in the order that costs the user least: is there room,
      // is the file huge, and whatever the caller wanted to ask.
      guardQuota(file, 'the text in that PDF', PDF_TEXT_BUDGET)
        .then(function (ok) {
          if (!ok) return null;
          return guardPdfSize(file);
        })
        .then(function (readOpts) {
          if (!readOpts) return;
          if (typeof opts.confirm !== 'function') {
            readPdf(file, readOpts);
            return;
          }
          var gate;
          try {
            gate = opts.confirm(file);
          } catch (e) {
            gate = false;
          }
          Promise.resolve(gate).then(function (ok2) {
            if (ok2 !== false) readPdf(file, readOpts);
          }, noop);
        }, noop);
    }

    /**
     * 06 #6: a 60 MB tiled PDF on a 3 GB phone kills the tab with no error to
     * read. Over the threshold, offer the first 20 pages instead.
     * @returns {Promise<object|null>} read options, or null to stop
     */
    function guardPdfSize(file) {
      var warnAt = (window.PdfText && window.PdfText.SIZE_WARN_BYTES) || 25 * 1024 * 1024;
      if (!file || file.size <= warnAt) return Promise.resolve({});
      return confirmSheet({
        title: 'That’s a ' + mb(file.size) + ' file',
        message:
          'Reading it may take a while or run out of memory on this phone. Read the first 20 pages?',
        confirmText: 'Read 20 pages',
        cancelText: 'Not now'
      }).then(function (ok) {
        return ok ? { maxPages: 20 } : null;
      });
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
    wrap.appendChild(cancelBtn);
    wrap.appendChild(fileInput);
    wrap.appendChild(resultLine);
    wrap.appendChild(emptyLine);

    wrap.zone = zone;
    wrap.fileInput = fileInput;
    wrap.setBusy = setBusy;
    wrap.showResult = showResult;
    wrap.take = takeFile;
    wrap.isReading = function () { return reading; };
    /**
     * Stop whatever this zone started: the read in progress, and any page
     * render on the handle it gave to onPages (a craft's "Stop" while it
     * rasterises chart pages). The handle is unusable afterwards.
     */
    wrap.cancel = function () {
      if (signal) signal.cancelled = true;
      if (handleSignal) handleSignal.cancelled = true;
    };
    /** The signal the onPages handle honours, to pass on as {signal}. */
    wrap.signal = function () { return handleSignal; };
    /** Call from the sheet's onClose so the document-level guard goes too. */
    wrap.destroy = function () {
      if (!docGuard) return;
      document.removeEventListener('dragover', docGuard);
      document.removeEventListener('drop', docGuard);
      docGuard = null;
    };
    // A file handed over by `importFileIntoCraft` (the New project sheet):
    // the first zone built while it is pending reads it, once it is mounted —
    // exactly as if it had been dropped here.
    if (pendingZoneFile) {
      var handed = pendingZoneFile;
      pendingZoneFile = null;
      window.setTimeout(function () {
        if (document.contains(wrap)) takeFile(handed);
      }, 0);
    }
    return wrap;
  }

  /** See `importFileIntoCraft`. Only ever set for one synchronous call. */
  var pendingZoneFile = null;

  /**
   * Open a craft's own importer (`def.openImportSheet`, the same sheet its
   * ⋯ → Import pattern uses) with `file` already dropped into it, so its own
   * preview / confirm step is the one the user sees. Both craft importers
   * build their drop zone through `ctx.pdfDropZone` while the sheet opens, so
   * the file is parked for exactly that call and cleared after it.
   * @returns {boolean} whether the importer took the file
   */
  function importFileIntoCraft(def, projectId, file) {
    if (!def || typeof def.openImportSheet !== 'function' || !file) return false;
    pendingZoneFile = file;
    try {
      def.openImportSheet(projectId, ctx);
    } catch (e) {
      toast('That sheet could not open');
    }
    var taken = pendingZoneFile === null;
    pendingZoneFile = null;
    if (!taken) toast('Drop the file again in the import sheet');
    return taken;
  }

  /* ================================================================== *
   * 16c. The shared import picker
   *
   * "Sections detected" (tick, rename, row counts) + "Checklist items found",
   * the two lists that used to live inside the Import pattern sheet. The New
   * project sheet shows exactly the same thing, so both sheets build one of
   * these instead of their own copy.
   *
   *   importPicker({
   *     rowWord: 'Round',          // for the "12 rounds" meta line
   *     sectionsLabel, checklistLabel, sectionsHint,
   *     tourList, tourChecklist,   // data-tour hooks the tours spotlight
   *     hideWhenEmpty: true,       // hide both fields until there is something
   *     onChange()                 // after any rebuild or tick
   *   }) -> { node, setText, getText, checkedSections, checkedChecklist,
   *           sectionCount, destroy }
   * ================================================================== */

  /**
   * wave H (knit-qa): "Gauge 12 sts × 17 rows = 4 in · 6 mm (US 10)", the
   * gauge an import reads, as printed (no conversion).
   */
  function gaugeChipText(g) {
    var parts = [];
    var nums = [];
    if (g.sts) nums.push(g.sts + ' sts');
    if (g.rows) nums.push(g.rows + ' rows');
    if (nums.length) parts.push('Gauge ' + nums.join(' × ') + ' = ' + (g.over || (g.unit === 'in' ? 4 : 10)) + ' ' + (g.unit === 'in' ? 'in' : 'cm'));
    if (g.needle) parts.push((nums.length ? '' : 'Needle ') + g.needle);
    return parts.join(' · ');
  }

  function importPicker(opts) {
    opts = opts || {};
    /** 'Round' / 'Row', or a function for a sheet where it can still change. */
    function word() {
      var w = typeof opts.rowWord === 'function' ? opts.rowWord() : opts.rowWord;
      return String(w || 'row').toLowerCase();
    }
    var text = '';
    var rows = [];
    var checkItems = [];
    /** 06 #3: informational only — the arithmetic is the same either way. */
    var dialect = null;
    /** 01 #1: the import sets targetRows unless the user says not to. */
    var noTargets = false;
    /**
     * Wave F (size-once, 03 #1): the document's sizes and the one picked.
     * `sizeChoice` null = not picked yet; a multi-size import is not created
     * until it is, so no part ever counts XS by default.
     */
    var sizeNames = [];
    var sizeDocCount = 0;
    var sizeChoice = typeof opts.initialSize === 'number' && opts.initialSize >= 0 ? opts.initialSize : null;
    /**
     * Wave G (size groups): a booklet of several sizes of the same toy. The
     * sizes are tabs, each with "Import this size" (all on by default), and
     * the parts and placing notes of the open one below.
     */
    var groupNames = [];
    var groupTicks = {};
    var openGroup = null;
    /** wave H (knit-qa): the knitter has ticked or unticked a pattern by hand. */
    var ticksTouched = false;
    /** wave H (knit-qa): the gauge the import will write, or null. */
    var gaugeRead = null;

    var node = el('div', 'imp-picker');

    var chips = el('div', 'imp-chips');
    chips.hidden = true;
    node.appendChild(chips);

    var sizeChips = el('div', 'size-chips');
    sizeChips.setAttribute('role', 'radiogroup');
    sizeChips.setAttribute('aria-label', 'Your size');
    var sizeField = field('Your size', sizeChips, 'Every count, row target and instruction is shown for this size. You can change it later in the part editor.');
    sizeField.classList.add('size-field');
    sizeField.hidden = true;
    node.appendChild(sizeField);

    var list = el('div', 'imp-list');
    if (opts.tourList) list.setAttribute('data-tour', opts.tourList);
    var listField = field(opts.sectionsLabel || 'Sections detected', list, opts.sectionsHint);

    // "Don't set targets" lives in the sections header, next to the numbers it
    // turns off (06 #3, 01 #1).
    var targetsRow = el('div', 'imp-targets');
    var targetsChk = button('check', '✓', 'Don’t set targets');
    targetsChk.setAttribute('role', 'checkbox');
    targetsChk.setAttribute('aria-checked', 'false');
    var targetsLabel = el('span', 'imp-targets-label', 'Don’t set targets');
    on(targetsChk, 'click', function () {
      noTargets = !noTargets;
      targetsChk.setAttribute('aria-checked', noTargets ? 'true' : 'false');
      renderList();
      changed();
    });
    on(targetsLabel, 'click', function () { targetsChk.click(); });
    targetsRow.appendChild(targetsChk);
    targetsRow.appendChild(targetsLabel);
    // After the <label>, before the list itself.
    listField.insertBefore(targetsRow, list);
    node.appendChild(listField);

    var checkList = el('div', 'imp-list');
    if (opts.tourChecklist) checkList.setAttribute('data-tour', opts.tourChecklist);
    var checkField = field(
      opts.checklistLabel || 'Checklist items found',
      checkList,
      'Ticked items get added to the assembly checklist.'
    );
    checkField.hidden = true;
    node.appendChild(checkField);

    function changed() {
      if (typeof opts.onChange === 'function') opts.onChange();
    }

    /** Wave H: the craft whose parser reads the text (`opts.craft`, a value or a function). */
    function craftKey() {
      var c = typeof opts.craft === 'function' ? opts.craft() : opts.craft;
      return typeof c === 'string' && c ? c : 'crochet';
    }

    /**
     * wave H (knit-qa): a knitting book's groups are PATTERNS (the sock
     * ebook's eight), not sizes of one toy: they are worded as patterns, only
     * the first is ticked to start with, and the size chips are the sizes of
     * the first pattern being imported.
     */
    function groupsArePatterns(secs) {
      if (craftKey() !== 'knitting') return false;
      if (!secs) return patGroups;
      // wave H (knit-qa-2): ...unless every group holds the SAME parts (the
      // Sandnes raglan's children's and ladies' halves: Yoke, Back And Front,
      // Sleeves in each). Those are size groups, all imported, as in crochet.
      return !groupsShareParts(secs);
    }
    var patGroups = false;

    /*
     * Wave K (E12, docs/wave-k/knit-parse.md): in a pattern BOOK exactly one
     * pattern is imported, and it is the one whose tab is open. `bookPick`
     * is its name; `bookList` is `Knits.bookPatterns(text)` (every pattern in
     * the contents, "unread" ones too, each with its own pages, sizes, gauge).
     * The size chips, the gauge chip, the checklist suggestions and the charts
     * kept are that pattern's own.
     */
    var bookPick = null;
    var bookList = null;
    var bookNames = [];
    /** wave K: the groups are one-of (a knitting book's patterns, or a knitting pattern's size groups) */
    var singleGroups = false;

    function readBookList() {
      if (craftKey() !== 'knitting') return null;
      var kp = parserOf('knitting');
      if (!kp || typeof kp.bookPatterns !== 'function') return null;
      try {
        var l = kp.bookPatterns(text);
        return Array.isArray(l) && l.length >= 2 ? l : null;
      } catch (e) {
        return null;
      }
    }

    /** The picked book pattern's record from bookPatterns, or null. */
    function bookEntry() {
      if (!patGroups || !bookList || !bookPick) return null;
      for (var i = 0; i < bookList.length; i++) if (bookList[i] && bookList[i].name === bookPick) return bookList[i];
      return null;
    }

    function groupHasRows(g) {
      return rows.some(function (r) { return r.group === g && r.rows > 0; });
    }

    /** A book's text cut to pages from..to ("=== PAGE n ===" markers); the whole text without markers. */
    function pagesText(t, pages) {
      if (!pages || !(pages.from >= 1)) return t;
      var out = [], on = false, any = false;
      String(t || '').split('\n').forEach(function (ln) {
        var m = /^=== PAGE (\d+) ===$/.exec(ln);
        if (m) { any = true; var n = +m[1]; on = n >= pages.from && n <= (pages.to || pages.from); }
        if (on) out.push(ln);
      });
      return any ? out.join('\n') : t;
    }

    /**
     * wave H (knit-qa-2): a knitting section with no numbered rows that is a
     * garment piece by name ("Back And Front", "Sleeves" of the Sandnes
     * raglan, worked "until it measures") is a part to import, not a note:
     * it arrived unticked and the import brought only the yokes.
     */
    function knitProsePart(sec) {
      if (craftKey() !== 'knitting' || !sec || !sec.name) return false;
      if (String(sec.text || '').replace(/\s+/g, ' ').length < 120) return false;
      // ...or it casts on / picks up a count of its own ("Cast on 72 sts,
      // divide sts on 3 needles" — Begin to Knit's sock cuff, unnamed)
      if (/\b(?:cast\s+on|co|pick\s+up(?:\s+and\s+knit)?)\s+\d+\s*(?:\(|sts?\b|stitches\b)/i.test(String(sec.text || ''))) return true;
      var nouns = (window.AppKnitting && Array.isArray(AppKnitting.sectionNames)) ? AppKnitting.sectionNames : [];
      var nm = String(sec.name).toLowerCase();
      return nouns.some(function (n) {
        var w = String(n).toLowerCase();
        return new RegExp('(?:^|\\s)' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?(?:\\s|$)').test(nm);
      });
    }

    /** Every group (two or more) has the same part names, in any order. */
    function groupsShareParts(secs) {
      var by = {}, order = [];
      secs.forEach(function (s) {
        if (!s.group) return;
        if (!by[s.group]) { by[s.group] = []; order.push(s.group); }
        by[s.group].push(String(s.name || '').toLowerCase().trim());
      });
      if (order.length < 2) return false;
      var sig = function (g) { return by[g].slice().sort().join('|'); };
      var first = sig(order[0]);
      return order.every(function (g) { return sig(g) === first; });
    }

    /** The gauge lines the knitting reader carries for these sections. */
    function groupGaugeLines(secs) {
      var out = [];
      secs.forEach(function (s) {
        (Array.isArray(s.gaugeLines) ? s.gaugeLines : []).forEach(function (g) {
          if (out.indexOf(g) < 0) out.push(String(g));
        });
      });
      return out.join('\n');
    }

    /** The first ticked pattern's sections (all of them when there are no groups). */
    function sizeSections(secs) {
      var first = null;
      secs.forEach(function (s) {
        if (first === null && s.group && groupTicks[s.group]) first = s.group;
      });
      // (knit-qa-2: before any tick is known — a first read of size groups —
      // the first group, which is ticked by default)
      if (first === null) {
        var known = secs.some(function (s) { return s.group && groupTicks[s.group] !== undefined; });
        if (!known) secs.forEach(function (s) { if (first === null && s.group) first = s.group; });
      }
      if (first === null) return secs;
      return secs.filter(function (s) { return s.group === first; });
    }

    /** The document's size names, else "Size 1".."Size N" from its longest list. */
    function findSizes(secs, ofText) {
      var names = null;
      var parser = parserOf(craftKey());
      if (parser && typeof parser.detectSizes === 'function') {
        try { names = parser.detectSizes(typeof ofText === 'string' ? ofText : text); } catch (e) { names = null; }
      }
      // wave H (knit-qa-2): a knitting group's carried "Sizes: 2 yrs, 4 yrs …"
      if (!(names && names.length >= 2) && typeof ofText === 'string' && typeof Store.sizesOfText === 'function') {
        names = Store.sizesOfText(ofText, craftKey());
      }
      sizeDocCount = names && names.length >= 2 ? names.length : 0;
      if (sizeDocCount) return names.slice();
      var n = 0;
      secs.forEach(function (sec, i) {
        var c = Store.sizeCount({ id: 'import-size:' + i, patternText: sec.text, sizeIndex: 0, sizeCount: 0, craft: craftKey() });
        if (c > n) n = c;
      });
      var out = [];
      for (var k = 0; k < n && n >= 2; k++) out.push('Size ' + (k + 1));
      return out;
    }

    function buildRows() {
      var secs = Store.splitSections(text, craftKey());
      var prevNames = sizeNames.join('|');
      var pat = groupsArePatterns(secs);
      patGroups = pat;
      bookList = pat ? readBookList() : null;
      // wave K (knit-audit): a knitting pattern's SIZE groups (the Sandnes
      // raglan's Children and Ladies halves, the same parts in each) are a
      // single choice too: the open tab is the group imported, with its own
      // sizes — importing both gave every part twice. Crochet's size groups
      // (the bee's Keyring / Medium / Big) stay "all on by default".
      var sizeGroupsOne = !pat && craftKey() === KNIT_ID && (function () {
        var gs = [];
        secs.forEach(function (s) { if (s.group && gs.indexOf(s.group) < 0) gs.push(s.group); });
        return gs.length >= 2;
      })();
      singleGroups = pat || sizeGroupsOne;
      if (singleGroups) {
        // wave K (E12): ONE pattern, the open tab's. Every pattern of the
        // contents is listed (bookPatterns), unread ones too; the pick
        // survives a re-read, else the first pattern that has rows.
        var seenG = [];
        if (bookList) bookList.forEach(function (b) { if (b && b.name && seenG.indexOf(b.name) < 0) seenG.push(b.name); });
        secs.forEach(function (s) { if (s.group && seenG.indexOf(s.group) < 0) seenG.push(s.group); });
        if (seenG.indexOf(bookPick) < 0) {
          bookPick = null;
          for (var bi = 0; bi < seenG.length && !bookPick; bi++) {
            var g0 = seenG[bi];
            var hasRows = secs.some(function (s) {
              return s.group === g0 && !s.unread && sectionRowInfo(s.text, 0, 0, 0, craftKey()).rows > 0;
            });
            if (hasRows) bookPick = g0;
          }
          if (!bookPick) bookPick = seenG[0] || null;
        }
        groupTicks = {};
        seenG.forEach(function (n) { groupTicks[n] = n === bookPick; });
        bookNames = seenG;
      } else {
        bookPick = null;
        bookNames = [];
      }
      // knitting groups (patterns or size ranges) each name their own sizes:
      // the chips are the first imported group's
      var sizeSecs = craftKey() === 'knitting' ? sizeSections(secs) : secs;
      var sizeText = sizeSecs === secs ? null : sizeSecs.map(function (s) { return s.text; }).join('\n');
      sizeNames = sizeText === null ? findSizes(secs) : findSizes(sizeSecs, sizeText);
      // wave H (knit-qa): the gauge the import will write (the imported
      // pattern's own in a book, with the gauge lines the reader carries for
      // it), shown in the preview
      var gaugeText = sizeText === null ? text : sizeText + '\n' + groupGaugeLines(sizeSecs);
      // wave K (E12): a book pattern's own sizes and gauge, from bookPatterns
      var be = bookEntry();
      if (be && Array.isArray(be.sizes) && be.sizes.length >= 2) {
        sizeNames = be.sizes.map(String);
        sizeDocCount = sizeNames.length;
      }
      if (be && (be.gaugeLine || be.needleLine)) gaugeText = [be.gaugeLine || '', be.needleLine || ''].join('\n');
      gaugeRead = craftKey() !== 'crochet' && typeof Store.gaugeFromText === 'function'
        ? Store.gaugeFromText(gaugeText, craftKey()) : null;
      // a different document's sizes are a different question
      if (sizeNames.join('|') !== prevNames && prevNames) sizeChoice = null;
      if (sizeChoice !== null && sizeChoice > sizeNames.length - 1) sizeChoice = null;
      var prev = rows;
      rows = secs.map(function (sec, i) {
        var info = sectionRowInfo(sec.text, i, sizeChoice === null ? 0 : sizeChoice, sizeDocCount, craftKey());
        var old = prev[i];
        var keep = old && old.parserName === sec.name;
        return {
          parserName: sec.name,
          name: keep ? old.name : sec.name,
          // (wave H, knit-qa-2: or a prose part the knitting reader offers)
          checked: keep ? old.checked : (info.rows > 0 || !!sec.offer || knitProsePart(sec)),
          offer: !!sec.offer,
          // wave G: the size group this section belongs to (null: one size)
          group: sec.group || null,
          makeCount: sec.makeCount,
          makeCountInferred: !!sec.makeCountInferred,
          // wave K (knit-parse P8): a garment pair (sleeves, socks …) and the knitter's "both at once"
          makeCountWhy: sec.makeCountWhy || null,
          pairNoun: sec.pairNoun || null,
          bothAtOnce: keep ? !!old.bothAtOnce : false,
          gaugeLines: sec.gaugeLines || null,
          text: sec.text,
          placement: sec.placement || '',
          rows: info.rows,
          computedOnly: info.computedOnly,
          hasTargets: info.hasTargets,
          mode: info.mode,
          target: info.target,
          approx: info.approx,
          report: info.report
        };
      });
      dialect = null;
      var dp = parserOf(craftKey());
      if (dp && typeof dp.dialectHints === 'function') {
        try { dialect = dp.dialectHints(text); } catch (e) { dialect = null; }
      }
      // wave G: the sizes, in document order; every one ticked by default,
      // a tick the maker took off survives a re-read of the same document
      var names = [];
      if (singleGroups) {
        // wave K (E12): a book lists every pattern; only the picked one is imported
        names = bookNames.slice();
      } else {
        rows.forEach(function (r) { if (r.group && r.rows > 0 && names.indexOf(r.group) < 0) names.push(r.group); });
        var was = groupTicks;
        groupTicks = {};
        names.forEach(function (n) { groupTicks[n] = was[n] === undefined ? true : was[n]; });
      }
      groupNames = names.length >= 2 ? names : [];
      if (singleGroups && bookPick) openGroup = bookPick;
      if (groupNames.indexOf(openGroup) < 0) openGroup = groupNames.length ? groupNames[0] : null;
    }

    function renderChips() {
      clear(chips);
      var any = false;
      if (dialect && dialect.uk && !dialect.us) {
        chips.appendChild(el('span', 'imp-chip', 'Looks like UK terms'));
        any = true;
      }
      // wave H (knit-qa): what the knitting import reads into the gauge card
      if (gaugeRead && (gaugeRead.sts || gaugeRead.rows || gaugeRead.needle)) {
        chips.appendChild(el('span', 'imp-chip imp-gauge', gaugeChipText(gaugeRead)));
        any = true;
      }
      chips.hidden = !any;
      renderSizes();
    }

    /** "Your size" chips (03 #1): one tap, and every number below follows. */
    function renderSizes() {
      clear(sizeChips);
      var hasRows = rows.some(function (r) { return r.rows > 0; });
      sizeField.hidden = !(sizeNames.length >= 2 && hasRows);
      if (sizeField.hidden) return;
      sizeField.classList.toggle('needs-pick', sizeChoice === null);
      sizeNames.forEach(function (name, i) {
        var b = button('size-chip' + (i === sizeChoice ? ' on' : ''), name);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', i === sizeChoice ? 'true' : 'false');
        b.setAttribute('data-focus-key', 'size-chip-' + i);
        // roving tabindex: one stop for the group, arrows move inside it
        b.tabIndex = (sizeChoice === null ? i === 0 : i === sizeChoice) ? 0 : -1;
        on(b, 'click', function () { pickSize(i); });
        on(b, 'keydown', function (e) {
          var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0);
          if (!d) return;
          e.preventDefault();
          pickSize((i + d + sizeNames.length) % sizeNames.length);
        });
        sizeChips.appendChild(b);
      });
    }

    function pickSize(i) {
      sizeChoice = i;
      preserveFocus(function () {
        buildRows();
        renderChips();
        renderList();
      });
      var on_ = sizeChips.querySelector('.size-chip.on');
      if (on_) { try { on_.focus(); } catch (e) { /* ignore */ } }
      changed();
    }

    function renderList() {
      clear(list);
      var any = false;
      rows.forEach(function (r) { if (r.rows > 0) any = true; });
      if (!rows.length || !any) {
        // In the New project sheet there is nothing to explain until a PDF has
        // been read, so the whole field stays out of the way.
        listField.hidden = !!opts.hideWhenEmpty;
        targetsRow.hidden = true;
        // wave K: the craft's own example (a knitter never reads "6 sc in MR")
        list.appendChild(el('p', 'muted imp-empty', craftCopy(craftKey(), 'importEmpty') || IMPORT_EMPTY));
        return;
      }
      listField.hidden = false;
      // Only worth offering when at least one section would get a target.
      targetsRow.hidden = !rows.some(function (r) { return r.rows > 0 && r.target; });
      var panel = list;
      if (groupNames.length) panel = renderGroupTabs();
      rows.forEach(function (r, i) {
        if (groupNames.length && r.group && r.group !== openGroup) return;
        var item = el('div', 'imp-item');
        var chk = button('check', '✓', 'Import ' + (r.name || 'section ' + (i + 1)));
        chk.setAttribute('role', 'checkbox');
        chk.setAttribute('aria-checked', r.checked ? 'true' : 'false');
        on(chk, 'click', function () {
          r.checked = !r.checked;
          chk.setAttribute('aria-checked', r.checked ? 'true' : 'false');
          changed();
        });

        var main = el('div', 'imp-main');
        var nameIn = textInput(r.name, 'Part ' + (i + 1));
        nameIn.className = 'imp-name';
        on(nameIn, 'input', function () {
          r.name = nameIn.value;
        });
        main.appendChild(nameIn);

        var meta = [];
        var isPair = r.makeCountWhy === 'pair' && r.makeCount === 2 && craftKey() === KNIT_ID;
        if (r.makeCount > 1) {
          meta.push('×' + r.makeCount + (isPair ? ' (a pair of ' + (r.pairNoun || 'pieces') + 's)'
            : r.makeCountInferred ? ' (from the assembly text)' : ''));
        }
        // The section's own word when it has one; the rows it will COUNT (the
        // target, which includes "Rep 3rd Rnd 3 times") when it has a target.
        var w = r.mode ? (r.mode === 'rounds' ? 'round' : 'row') : word();
        // Wave F: with sizes and none picked, the target is not known yet.
        var sizePending = sizeNames.length >= 2 && sizeChoice === null;
        var n = r.rows && r.target && !noTargets && !sizePending ? r.target : r.rows;
        meta.push(r.rows ? (r.approx && n === r.target ? '≈ ' : '') + n + ' ' + w + (n === 1 ? '' : 's') : 'no ' + w + 's');
        // 01 #1: say the target out loud so it is visible and correctable.
        if (r.rows && r.target && !noTargets && !sizePending) meta.push('→ target ' + (r.approx ? '≈ ' : '') + r.target);
        if (r.rows && sizePending) meta.push('pick your size for targets');
        // The parser found assembly prose for this piece - it lands in the
        // part's Placing button, not in its rounds.
        if (r.placement) meta.push('placing notes');
        // wave G: a piece that turns from rounds into rows says where
        var rowsFrom = rowsFromOf(r);
        if (rowsFrom) meta.push('in rows from row ' + rowsFrom);
        main.appendChild(el('div', 'imp-meta', meta.join(' · ')));
        // wave G: under a size's tab, the placing notes themselves (the eyes
        // "in the 2nd round, 4 stitches apart" differ from size to size)
        if (groupNames.length && r.placement) {
          var pl = el('div', 'imp-place');
          r.placement.split('\n').slice(0, 3).forEach(function (ln) {
            pl.appendChild(el('div', 'imp-place-line', ln));
          });
          main.appendChild(pl);
        }
        // Wave F (06 #1 / #8): one confidence line per part - what the
        // counts rest on. A disagreement is the line people need to see.
        var rep = r.report;
        if (r.rows && rep && rep.rows) {
          var conf = countLineText(rep, w, false).replace(/^\d+ \w+(?: · |$)/, '');
          if (!conf) conf = rep.printed === rep.rows ? 'every count printed' : '';
          if (conf) {
            var cl = el('div', 'imp-conf' + (rep.disagree.length || rep.unresolved ? ' warn' : ''));
            // wave K: the shared badge in front, and the check sheet one tap away
            var ck = sectionCheck(r, w);
            if (ck && window.CheckSheet) cl.appendChild(window.CheckSheet.badge(ck.verdict));
            cl.appendChild(el('span', 'imp-conf-text', conf));
            if (ck && window.CheckSheet) {
              var see = button('linkish check-open', 'See the check', 'See the check for ' + (r.name || 'this part'));
              on(see, 'click', function (e) {
                e.stopPropagation();
                openCheckSheet(sectionCheck(r, w, true));
              });
              cl.appendChild(see);
            }
            main.appendChild(cl);
          }
        }

        // wave K (P8): a pair the reader found ("Sleeves", "Socks") can be knit both at once
        if (isPair && r.checked) {
          var both = button('chip imp-both' + (r.bothAtOnce ? ' on' : ''), 'Knit both at once',
            'Knit both ' + (r.pairNoun || 'pieces') + 's at once: one row tap moves both');
          both.setAttribute('aria-pressed', r.bothAtOnce ? 'true' : 'false');
          both.setAttribute('data-both-at-once', '1');
          on(both, 'click', function (e) {
            e.stopPropagation();
            r.bothAtOnce = !r.bothAtOnce;
            both.classList.toggle('on', r.bothAtOnce);
            both.setAttribute('aria-pressed', r.bothAtOnce ? 'true' : 'false');
          });
          main.appendChild(both);
        }

        item.appendChild(chk);
        item.appendChild(main);
        panel.appendChild(item);
      });
    }

    /** Wave G: the first row a piece works in rows after starting in the round. */
    function rowsFromOf(r) {
      if (r.rowsFrom !== undefined) return r.rowsFrom;
      r.rowsFrom = null;
      var rp = parserOf(craftKey());
      if (r.mode !== 'rounds' || !rp || typeof rp.parse !== 'function') return null;
      try {
        var ls = rp.parse(r.text);
        for (var k = 0; k < ls.length; k++) {
          if (ls[k].kind === 'row' && ls[k].workedIn === 'rows') { r.rowsFrom = ls[k].row; break; }
        }
      } catch (e) { r.rowsFrom = null; }
      return r.rowsFrom;
    }

    /**
     * Wave G: the size tabs above the section list - role=tablist, arrow keys
     * between sizes, and "Import this size" for the open one. Returns the
     * panel the open size's sections go into.
     */
    function renderGroupTabs() {
      var strip = el('div', 'size-tabs imp-size-tabs');
      strip.setAttribute('role', 'tablist');
      var pat = groupsArePatterns();
      strip.setAttribute('aria-label', pat ? 'Patterns in this book' : 'Sizes in this pattern');
      var uid0 = 'imp-size-' + Math.random().toString(36).slice(2, 8);
      var selId = '';
      groupNames.forEach(function (g, gi) {
        var sel = g === openGroup;
        var t = button('size-tab' + (sel ? ' active' : '') + (groupTicks[g] ? '' : ' off'));
        t.id = uid0 + '-' + gi;
        if (sel) selId = t.id;
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', sel ? 'true' : 'false');
        t.setAttribute('aria-controls', uid0 + '-panel');
        t.setAttribute('data-focus-key', 'imp-size-tab:' + g.replace(/"/g, ''));
        t.tabIndex = sel ? 0 : -1;
        t.appendChild(el('span', 'size-tab-name', g));
        var unreadG = pat && !groupHasRows(g);
        if (unreadG) t.appendChild(el('span', 'size-tab-skip', ' · not read'));
        else if (!groupTicks[g] && !pat) t.appendChild(el('span', 'size-tab-skip', ' · skipped'));
        t.setAttribute('aria-label', pat
          ? g + (unreadG ? ', rows not read' : '') + (groupTicks[g] ? ', the pattern to import' : '')
          : g + ' size' + (groupTicks[g] ? '' : ', not imported'));
        var go = function (to, focus) {
          openGroup = groupNames[to];
          if (singleGroups) {
            // wave K (E12): in a book the open tab IS the pattern imported —
            // its sizes, gauge, checklist and charts follow it
            bookPick = openGroup;
            ticksTouched = true;
            buildRows();
            renderChips();
            buildChecks();
            renderChecks();
            renderList();
            changed();
          } else {
            renderList();
          }
          if (focus) {
            var nt = list.querySelector('[data-focus-key="imp-size-tab:' + openGroup.replace(/"/g, '') + '"]');
            if (nt) { try { nt.focus({ preventScroll: true }); } catch (e) { nt.focus(); } }
          }
        };
        on(t, 'click', function () { if (!sel) go(gi, false); });
        on(t, 'keydown', function (e) {
          var to = -1;
          if (e.key === 'ArrowRight') to = (gi + 1) % groupNames.length;
          else if (e.key === 'ArrowLeft') to = (gi - 1 + groupNames.length) % groupNames.length;
          else if (e.key === 'Home') to = 0;
          else if (e.key === 'End') to = groupNames.length - 1;
          if (to < 0 || to === gi) return;
          e.preventDefault();
          go(to, true);
        });
        strip.appendChild(t);
      });
      list.appendChild(strip);
      var panel = el('div', 'imp-size-panel');
      panel.id = uid0 + '-panel';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', selId);
      if (singleGroups) {
        // wave K (E12): no tick in a book — the open tab is the one pattern imported
        var note = el('div', 'imp-book-pick', groupHasRows(openGroup)
          ? 'Importing “' + openGroup + '” only — pick ' + (pat ? 'another pattern' : 'the other sizes') + ' above to import that one instead.'
          : 'The app could not read the rows of “' + openGroup + '”. Importing it gives one part with its text, to count by hand.');
        note.setAttribute('role', 'status');
        note.setAttribute('data-book-pick', openGroup);
        panel.appendChild(note);
        list.appendChild(panel);
        return panel;
      }
      var tickRow = el('div', 'imp-targets imp-size-tick');
      var tick = button('check', '✓', pat ? 'Import ' + openGroup : 'Import the ' + openGroup + ' size');
      tick.setAttribute('role', 'checkbox');
      tick.setAttribute('aria-checked', groupTicks[openGroup] ? 'true' : 'false');
      tick.setAttribute('data-focus-key', 'imp-size-tick');
      on(tick, 'click', function () {
        groupTicks[openGroup] = !groupTicks[openGroup];
        ticksTouched = true;
        // wave H (knit-qa): a pattern's sizes are its own, so the chips follow
        // the first ticked pattern
        if (pat) preserveFocus(function () { buildRows(); renderChips(); renderList(); });
        else preserveFocus(renderList);
        changed();
      });
      var tickLabel = el('span', 'imp-targets-label', pat ? 'Import this pattern' : 'Import this size');
      on(tickLabel, 'click', function () { tick.click(); });
      tickRow.appendChild(tick);
      tickRow.appendChild(tickLabel);
      panel.appendChild(tickRow);
      panel.classList.toggle('skipped', !groupTicks[openGroup]);
      list.appendChild(panel);
      return panel;
    }

    /* ---------------- checklist suggestions ---------------- */

    function buildChecks() {
      var found = [];
      // wave K (E12): a book pattern's own finishing steps, from its own pages
      var be = bookEntry();
      var checkText = text;
      if (patGroups && bookPick) {
        // the picked pattern's own pages; without page markers, its own sections' text
        var paged = be && be.pages ? pagesText(text, be.pages) : text;
        if (paged !== text) checkText = paged;
        else {
          var own = rows.filter(function (r) { return r.group === bookPick; }).map(function (r) { return r.text; });
          if (own.length) checkText = own.join('\n');
        }
      }
      try {
        found = Store.suggestChecklist(checkText, craftKey()) || [];
      } catch (e) {
        found = [];
      }
      var was = {};
      checkItems.forEach(function (c) { was[c.text.toLowerCase()] = c.checked; });
      checkItems = found.map(function (s) {
        // Store.suggestChecklist hands back { text, confidence }.
        var t = String(s && s.text !== undefined ? s.text : s);
        var conf = (s && s.confidence) === 'strong' ? 'strong' : 'weak';
        var key = t.toLowerCase();
        return {
          text: t,
          confidence: conf,
          // 01 #3: anything we had to reconstruct arrives unticked.
          checked: was[key] === undefined ? conf === 'strong' : was[key]
        };
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
          changed();
        });
        item.appendChild(chk);
        var txt = el('div', 'imp-check-text', c.text);
        if (c.confidence === 'weak') {
          txt.appendChild(el('span', 'imp-weak', ' · check this one'));
        }
        item.appendChild(txt);
        checkList.appendChild(item);
      });
    }

    function refresh() {
      buildRows();
      renderChips();
      renderList();
      buildChecks();   // after buildRows: a book's checklist reads the picked pattern's rows
      renderChecks();
      changed();
    }

    /**
     * Wave K: a section's count report as a Check (js/checksheet.js). With
     * `withLines` the table gets one row per counted pattern line (parsed
     * on demand, only when the sheet opens).
     */
    function sectionCheck(r, w, withLines) {
      if (!window.CheckSheet || !r || !r.report || !r.report.rows) return null;
      var o = { word: w || word(), name: r.name || '' };
      if (withLines) {
        var rp = parserOf(craftKey());
        try { o.lines = rp && typeof rp.parse === 'function' ? rp.parse(r.text) : null; } catch (e) { o.lines = null; }
      }
      return window.CheckSheet.fromCountReport(r.report, o);
    }

    /** Wave K: every ticked section's check in one ("off" if any is off). */
    function combinedCheck() {
      if (!window.CheckSheet) return null;
      var secs = rows.filter(function (r) { return r.checked && r.rows > 0 && r.report && r.report.rows; });
      if (!secs.length) return window.CheckSheet.normalize({ verdict: 'unchecked', rows: [] });
      var verdicts = secs.map(function (r) { return sectionCheck(r).verdict; });
      var off = secs.filter(function (r, i) { return verdicts[i] === 'off'; });
      var v = off.length ? 'off'
        : verdicts.indexOf('close') >= 0 ? 'close'
        : verdicts.every(function (x) { return x === 'exact'; }) ? 'exact' : 'close';
      return window.CheckSheet.normalize({
        verdict: v,
        title: 'Counts against the pattern',
        summary: off.length
          ? (off.length === 1 ? (off[0].name || 'One part') + '’s counts disagree' : off.length + ' parts’ counts disagree') +
            ' with the pattern in many places — the stitch terms or the size may be read wrong.'
          : v === 'exact' ? 'Every count is printed in the pattern.' : 'Some counts are worked out by the app (≈).',
        rows: secs.map(function (r, i) {
          var rep = r.report;
          return {
            label: r.name || 'Part ' + (i + 1), verdict: verdicts[i] === 'unchecked' ? 'unknown' : (verdicts[i] === 'close' ? 'close' : verdicts[i]),
            printed: rep.printed, read: rep.rows,
            why: countLineText(rep, word(), false)
          };
        }),
        note: 'Printed: rows whose count is printed. Read: rows the app counted.'
      });
    }

    function checkedSections() {
      var out = [];
      rows.forEach(function (r) {
        // wave G: a size left out with "Import this size" brings none of its parts
        if (r.checked && groupNames.length && r.group && !groupTicks[r.group]) return;
        // wave H (knit-qa-2): in a pattern BOOK a section outside every pattern is
        // front matter (Begin to Knit's "Knitting:" lesson), not a shared part
        if (r.checked && groupNames.length && !r.group && patGroups) return;
        if (r.checked) {
          var sec = {
            name: (r.name || '').trim(),
            makeCount: r.makeCount,
            text: r.text,
            placement: r.placement || ''
          };
          if (r.makeCountInferred) sec.makeCountInferred = true;
          if (r.gaugeLines) sec.gaugeLines = r.gaugeLines;
          if (r.group) sec.group = r.group;
          out.push(sec);
        }
      });
      return out;
    }

    refresh();

    return {
      node: node,
      setText: function (t) {
        var nt = typeof t === 'string' ? t : '';
        if (nt !== text) ticksTouched = false;
        text = nt;
        refresh();
      },
      getText: function () { return text; },
      /** Redraw the section list (the row word may have changed under it). */
      rerender: renderList,
      /** `opts.noTargets` for Store.importPatternSections. */
      noTargets: function () { return noTargets; },
      /** Wave F: the picked size index for Store.importPatternSections, or null. */
      size: function () { return sizeNames.length >= 2 ? sizeChoice : null; },
      /** wave H (knit-qa-2): the single ticked pattern of a book (its name), else null */
      patternName: function () {
        if (!patGroups) return null;
        var t = groupNames.filter(function (g) { return groupTicks[g]; });
        return t.length === 1 ? t[0] : null;
      },
      /** Wave F: the document has sizes and none is picked yet. */
      needsSize: function () {
        return sizeNames.length >= 2 && sizeChoice === null && rows.some(function (r) { return r.rows > 0 && r.checked; });
      },
      /** Wave F: bring the size chips into view and focus them (the "pick first" nudge). */
      focusSize: function () {
        if (sizeField.hidden) return;
        try { sizeField.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
        var b = sizeChips.querySelector('.size-chip');
        if (b) { try { b.focus(); } catch (e2) { /* ignore */ } }
        sizeField.classList.remove('nudge');
        void sizeField.offsetWidth;
        sizeField.classList.add('nudge');
      },
      checkedSections: checkedSections,
      /** Wave K: the ticked sections' Check (js/checksheet.js), or null. */
      check: combinedCheck,
      /** Wave K (E12): the picked book pattern's PDF pages ({from, to}), or null (not a book). */
      bookPages: function () { var be = bookEntry(); return be && be.pages ? { from: be.pages.from, to: be.pages.to } : null; },
      /**
       * Wave K (knit-audit 1): the text an import reads its document-wide
       * facts from (sizes, gauge, abbreviations). In a book, the picked
       * pattern's own pages (else its own sections), so a one-size pattern
       * never takes the book's first pattern's sizes; otherwise everything.
       */
      importText: function () {
        if (!patGroups || !bookPick) return text;
        var be = bookEntry();
        var paged = be && be.pages ? pagesText(text, be.pages) : text;
        if (paged !== text) return paged;
        var own = rows.filter(function (r) { return r.group === bookPick; }).map(function (r) { return r.text; });
        return own.length ? own.join('\n') : text;
      },
      /** Wave K (E12): the picked book pattern's name, or null. */
      bookPick: function () { return patGroups ? bookPick : null; },
      /** Wave K (E12): pick a book pattern as the tab does (tests, deep links). */
      pickBookPattern: function (name) {
        if (!patGroups || groupNames.indexOf(name) < 0) return false;
        bookPick = name; openGroup = name; ticksTouched = true;
        buildRows(); renderChips(); buildChecks(); renderChecks(); renderList(); changed();
        return true;
      },
      /** Wave K (P8): names of the ticked pair sections the knitter wants knit both at once. */
      bothAtOnce: function () {
        return rows.filter(function (r) { return r.checked && r.bothAtOnce && r.makeCountWhy === 'pair'; })
          .map(function (r) { return (r.name || '').trim(); });
      },
      checkedChecklist: function () {
        return checkItems.filter(function (c) { return c.checked; }).map(function (c) { return c.text; });
      },
      /** How many sections the parser found that actually have rows. */
      sectionCount: function () {
        var n = 0;
        rows.forEach(function (r) { if (r.rows > 0) n++; });
        return n;
      },
      destroy: noop
    };
  }

  /**
   * Add checklist texts to a project, skipping ones it already has.
   * @returns {number} how many were actually added
   */
  function addChecklistItems(projectId, texts) {
    if (!Array.isArray(texts) || !texts.length) return 0;
    var proj = Store.project(projectId);
    if (!proj) return 0;
    var seen = {};
    (proj.checklist || []).forEach(function (c) {
      seen[String(c.text || '').trim().toLowerCase()] = true;
    });
    var added = 0;
    texts.forEach(function (t) {
      var key = String(t || '').trim().toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      if (Store.addChecklistItem(projectId, t)) added++;
    });
    return added;
  }

  /**
   * Paste a whole pattern, see the sections the parser found, then either
   * create/update one part per section or drop the lot into the active part.
   */
  function openImportSheet(projectId, initialText) {
    var p = Store.project(projectId);
    if (!p) return;
    var activeName = (Store.activePart(p) || {}).name || 'this part';
    var area, picker;
    var dropZone = null;
    var demoter = null;   // wave K: "off" demotes Create parts behind a confirm

    function refresh() {
      if (picker) picker.setText(area.value);
      syncCheckDemote();
    }

    function syncCheckDemote() {
      if (!picker || typeof picker.check !== 'function' || !window.CheckSheet) return;
      var btn = document.querySelector('dialog [data-tour="import-create"]');
      if (!btn) return;
      var c = picker.check();
      if (!demoter) demoter = window.CheckSheet.demote(btn, c);
      else demoter.set(c);
    }

    /* ---------------- PDF drop zone (the shared builder) ---------------- */

    function buildZone(body) {
      // wave H: a knitting project keeps the PDF's chart pages (knitZoneOpts)
      dropZone = pdfDropZone(knitZoneOpts({
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
          announce('Read ' + plural(res.pages, 'page') + ' from the PDF');
        }
      }, p.craft || 'crochet'));
      body.appendChild(dropZone);
    }

    openSheet({
      subject: p.id,
      title: 'Import pattern',
      cls: 'sheet-import',
      build: function (body) {
        buildZone(body);

        area = textArea(initialText || '', 'mono', 'Paste the instructions from your PDF');
        area.setAttribute('aria-label', 'Pattern text to import');
        area.setAttribute('data-tour', 'import-text');
        body.appendChild(field('Pattern text', area, 'Drop the PDF above, or paste the instructions straight in.'));

        picker = importPicker({
          rowWord: rowWord(p),
          tourList: 'import-list',
          tourChecklist: 'import-checklist',
          // wave F: a re-import keeps the size already picked for the project
          initialSize: p.size ? p.size.index : null,
          // wave H: the project's craft reads it (knitting → Knits)
          craft: p.craft || 'crochet',
          // wave K: ticking a section re-checks the button's standing
          onChange: function () { syncCheckDemote(); }
        });
        body.appendChild(picker.node);

        on(area, 'input', debounce(refresh, 200));
        refresh();
        // the footer is built after the body
        window.setTimeout(syncCheckDemote, 0);
      },
      onClose: function () {
        if (dropZone) dropZone.destroy();
        if (picker) picker.destroy();
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
            if (picker.needsSize()) {
              toast('Pick your size first');
              picker.focusSize();
              return;
            }
            Store.importPatternSections(
              p.id,
              [{ name: activeName, makeCount: 1, text: area.value }],
              { mode: 'active', text: area.value, noTargets: picker.noTargets(), size: picker.size() }
            );
            var extra = addChecklistItems(p.id, picker.checkedChecklist());
            knitAttachCharts(p.id, picker.bookPages ? picker.bookPages() : null);   // wave H: the PDF's chart pages
            knitKeepMaterials(p.id, area.value, picker.bookPick ? picker.bookPick() : null);   // wave K (P20)
            api.close();
            render();
            toast('Pattern saved into ' + activeName + checklistSuffix(extra), { ms: extra ? 3200 : 2600 });
          }
        },
        {
          text: 'Create parts',
          cls: 'btn primary',
          tour: 'import-create',
          onClick: function createParts(api) {
            var secs = picker.checkedSections();
            if (!secs.length) {
              toast('Tick at least one section first');
              return;
            }
            if (picker.needsSize()) {
              toast('Pick your size first');
              picker.focusSize();
              return;
            }
            // wave K (BUILD.md): a check that says "off" asks first; it never blocks
            if (demoter && demoter.isDemoted() && !api.__checked) {
              demoter.guard(confirmSheet, { confirmText: 'Create parts anyway' }).then(function (go) {
                if (!go) return;
                api.__checked = true;
                createParts(api);
              });
              return;
            }
            var res = Store.importPatternSections(p.id, secs, {
              mode: 'parts', text: picker.importText ? picker.importText() : area.value, noTargets: picker.noTargets(), size: picker.size()
            });
            var pairs = applyBothAtOnce(p.id, picker.bothAtOnce ? picker.bothAtOnce() : []);   // wave K (P8)
            var extra = addChecklistItems(p.id, picker.checkedChecklist());
            knitAttachCharts(p.id, picker.bookPages ? picker.bookPages() : null);   // wave H: the PDF's chart pages
            knitKeepMaterials(p.id, area.value, picker.bookPick ? picker.bookPick() : null);   // wave K (P20)
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
            if (res.sizeSet) msg += ' · size ' + res.sizeSet;
            if (pairs) msg += ' · ' + (pairs === 1 ? 'a pair' : pairs + ' pairs') + ' knit both at once';
            toast(msg + placingSuffix(res.placed) + checklistSuffix(extra), { ms: 3600 });
            modeFlipToast(res);
          }
        }
      ]
    });
  }

  /**
   * 05 #2: the import decided this whole pattern is worked in rounds and moved
   * the project off 'rows'. Say so once — the flip is the difference between a
   * tail rendering as a tail and rendering as a blanket, and nothing else in
   * the UI would ever mention it. `importPatternSections` only reports it on
   * the import that actually changed the project, so it cannot repeat.
   */
  function modeFlipToast(res) {
    if (!res || !res.modeFlipped) return;
    window.setTimeout(function () {
      toast('This pattern is worked in rounds — switched the project to Rounds', { ms: 4200 });
    }, 900);
  }

  /**
   * Wave K (P8): after a knitting import, the pairs the knitter asked to knit
   * both at once become two linked parts (Store.splitTwoAtATime: "Sleeve 1" +
   * "Sleeve 2", one row tap moves both). Matched by name, made twice, not started.
   * @returns {number} how many pairs were split
   */
  function applyBothAtOnce(projectId, names) {
    if (!names || !names.length || typeof Store.splitTwoAtATime !== 'function') return 0;
    var n = 0;
    names.forEach(function (name) {
      var proj = Store.project(projectId);
      if (!proj) return;
      var hit = proj.parts.filter(function (q) {
        return q.name === name && q.makeCount === 2 && !q.piecesDone && !q.row && !q.stitch;
      })[0];
      if (hit && Store.splitTwoAtATime(projectId, hit.id)) n++;
    });
    return n;
  }

  function checklistSuffix(n) {
    return n ? ' · + ' + plural(n, 'checklist item') : '';
  }

  /** Said once, however many parts got assembly prose out of the PDF. */
  function placingSuffix(n) {
    return n ? ' · placing notes' : '';
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
      subject: projectId,
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

        // Wave F (size-once): whose numbers are marked, and the per-size
        // blocks ("Size XS:", "Sizes M, L … only:") that are not yours dimmed.
        var sizeInfo = Store.partSize(p, prt);
        if (sizeInfo.label) {
          var sizeHead = el('p', 'pline-size', 'Your size: ');
          sizeHead.appendChild(el('mark', 'size-mark', sizeInfo.label));
          sizeHead.appendChild(document.createTextNode(
            sizeInfo.source === 'part' ? ' (this part only)' : (sizeInfo.source === 'project' ? '' : ' — not picked yet, change it in the part editor')));
          body.appendChild(sizeHead);
        }
        var scopeMine = null;  // a "Size XS:" label carries over the lines below it

        var wrap = el('div', 'pattern-lines');
        var currentNode = null;
        lines.forEach(function (line) {
          var hasRow = typeof line.row === 'number' && line.row > 0;
          var isSetup = line.kind === 'setup' || (line.row === 0 && line.kind !== 'header' && line.kind !== 'note');
          var notes = Store.notesOf(line);

          // A wrapped line the parser merged into the row above is already
          // in that row's text; listing it again doubled it (wave F).
          if (line.consumed) return;
          // Section headers are not tappable.
          if (line.kind === 'header') {
            scopeMine = null;
            wrap.appendChild(el('div', 'pline-header', line.text));
            return;
          }

          var mine = null;
          var scp = parserOf(p);   // wave H: the project's craft's parser
          if (sizeInfo.names.length >= 2 && scp && typeof scp.sizeScope === 'function') {
            var sc = null;
            try { sc = scp.sizeScope(line.text, sizeInfo.names); } catch (eS) { sc = null; }
            if (sc) {
              mine = !sc.indices || sc.indices.indexOf(sizeInfo.index) >= 0;
              scopeMine = sc.label ? mine : null;
            } else if (hasRow) {
              scopeMine = null;
            } else {
              mine = scopeMine;
            }
          }
          var sizeCls = mine === false ? ' other-size' : '';

          // Setup / foundation lines: labelled, not tappable (there is no row 0).
          if (!hasRow && isSetup) {
            var setupNode = el('div', 'pline pline-setup' + sizeCls);
            setupNode.appendChild(el('span', 'pline-tag', 'Setup'));
            var setupBody = el('span', 'pline-body');
            fillSizeMarked(setupBody, line.text, prt, p);
            setupNode.appendChild(setupBody);
            wrap.appendChild(setupNode);
            appendNotes(wrap, notes);
            return;
          }

          var isCurrent =
            (hasRow &&
            lineCoversRow(line, ri.patternRow) &&
            (currentSection === null || typeof line.section !== 'number' || line.section === currentSection)) ||
            // Past the written rows the repeat sentence that owns the row is
            // the current line ("Rep 3rd Rnd 3 times" is rounds 4-6).
            (!hasRow && line.kind === 'repeat' && line === currentLine);
          var cls = 'pline' + (hasRow ? ' has-row' : ' plain') + (isCurrent ? ' on' : '') + sizeCls;
          var node = button(cls, '');
          // Wave F (size-once): the chosen size's numbers marked.
          var txt = el('span', 'pline-text');
          fillSizeMarked(txt, line.text, prt, p);
          node.appendChild(txt);
          if (hasRow && Store.isComputed(line)) {
            var c = Store.countOf(line);
            if (c !== null) {
              node.appendChild(document.createTextNode(' '));
              node.appendChild(el('span', 'pline-count', '≈' + c));
            }
          }
          // Wave F (06 #1): what the count rests on, where it is not simply printed.
          if (hasRow && line.deviation) {
            node.appendChild(document.createTextNode(' '));
            node.appendChild(el('span', 'pline-count warn',
              'says ' + line.deviation.printed + ' · makes ' + line.deviation.computed));
          } else if (hasRow && line.sizeUnresolved) {
            node.appendChild(document.createTextNode(' '));
            node.appendChild(el('span', 'pline-count warn', 'no count for your size'));
          }
          if (mine === false) node.setAttribute('aria-description', 'for another size');
          if (isCurrent && !currentNode) {
            currentNode = node;
            node.setAttribute('aria-current', 'true');
          }
          if (hasRow) {
            on(node, 'click', function () {
              confirmSheet({
                title: 'Jump to ' + partRowWord(p, prt).toLowerCase() + ' ' + line.row + '?',
                message: 'The counter will move to ' + partRowWord(p, prt).toLowerCase() + ' ' + line.row +
                  ' and stitches reset to 0.',
                confirmText: 'Jump'
              }).then(function (ok) {
                if (!ok) return;
                Store.jumpToRow(p.id, prt.id, line.row);
                api.close();
                render();
                announce('Working ' + partRowWord(p, prt).toLowerCase() + ' ' + line.row);
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
      subject: projectId,
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
          chk.setAttribute('data-focus-key', 'chk:' + item.id);
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
            inp.setAttribute('data-focus-key', 'rename:' + item.id);
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
            text.setAttribute('data-focus-key', 'rename:' + item.id);
            on(text, 'click', function () {
              editingId = item.id;
              refresh();
            });
            row.appendChild(text);
          }

          var up = button('item-move', '▲', 'Move ' + item.text + ' up');
          up.setAttribute('data-focus-key', 'up:' + item.id);
          up.disabled = idx === 0;
          on(up, 'click', function () {
            Store.moveChecklistItem(p.id, item.id, -1);
            refresh();
          });
          var down = button('item-move', '▼', 'Move ' + item.text + ' down');
          down.setAttribute('data-focus-key', 'down:' + item.id);
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
                confirmText: 'Clear the list',
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

        // D5: rebuild the list without dropping keyboard focus.
        function refresh() {
          preserveFocus(refreshNow);
        }

        function refreshNow() {
          var done = 0;
          p.checklist.forEach(function (i) { if (i.done) done++; });
          count.textContent = p.checklist.length ? done + ' of ' + p.checklist.length + ' done' : '';
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
      subject: projectId,
      title: 'Project notes',
      build: function (body) {
        var area = textArea(p.notes, '', 'Hook 4mm · Paintbox DK · pattern link…');
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
      subject: projectId,
      title: 'Placement notes · ' + prt.name,
      build: function (body) {
        var area = textArea(prt.placementNotes, '', 'Eyes between rnd 8–9, 6 sts apart');
        area.style.minHeight = '180px';
        var save = debounce(function () {
          Store.updatePart(p.id, prt.id, { placementNotes: area.value });
        }, 400);
        on(area, 'input', save);
        body.appendChild(field('Where things go', area, prt.placementNotes ? 'Saves as you type.' : 'Nothing noted yet. Saves as you type.'));
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
      subject: projectId,
      title: 'Stitch alerts · ' + prt.name,
      build: function (body) {
        input = textInput(prt.alerts.join(', '), '40, 80');
        body.appendChild(
          field('Buzz at stitch', input, prt.alerts.length ? 'Comma-separated stitch numbers within a row. Great for marking increases.' : 'Nothing set yet. Type stitch numbers, separated by commas — great for marking increases.')
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
      subject: projectId,
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
          // The piece's own word when the piece is still there.
          var hp = Store.part(p, h.partId);
          row.appendChild(el('span', null, h.partName + ' · ' + (hp ? partShortRowWord(p, hp) : shortRowWord(p)) + ' ' + h.row));
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
      subject: projectId,
      title: 'Project status',
      build: function (body, api) {
        var list = el('div', 'list');
        STATUS_INFO.forEach(function (s) {
          var b = button('status-opt' + (p.status === s.id ? ' on' : ''));
          b.appendChild(el('b', null, s.label));
          b.appendChild(el('span', null, s.desc));
          on(b, 'click', function () {
            // "Finished" goes through finishProject so the parts that are not
            // done get a say (02 #2); everything else is a plain status.
            if (s.id === 'finished') {
              var res = Store.finishProject(p.id);
              api.close();
              render();
              if (res && res.ok) {
                celebrate('project');
                toast('Now finished');
              } else {
                showProjectDoneSheet(p, res ? res.blocking : []);
              }
              return;
            }
            Store.setStatus(p.id, s.id);
            api.close();
            render();
            toast('Now ' + s.label.toLowerCase());
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
    // wave K: the craft's working mode, full screen (def.workMode)
    if (craftWorkSpec(def) && window.WorkMode) {
      items.push({ icon: craftWorkSpec(def).icon || '⤢', label: craftWorkSpec(def).label || 'Working mode', run: function () { workModeApi.open(); } });
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
    // wave K (00 gap 10): every craft can save its project as a template
    items.push({ icon: '🧵', label: 'Save as template', run: function () { saveProjectAsTemplate(p); } });
    fileMenuItems(p).forEach(function (it) { items.push(it); });
    items.push({
      icon: '❓',
      label: 'Show me around',
      run: function () {
        // A craft that registered its own tour (same id as the craft) gets it;
        // otherwise fall back to the crochet counter tour.
        var id = 'counter';
        if (def && tourAvailable()) {
          try {
            window.Tour.list().forEach(function (t) { if (t.id === def.id) id = def.id; });
          } catch (e) { /* keep the fallback */ }
        }
        startTour(id);
      }
    });
    return items;
  }

  /** Wave H: a counter craft's own ⋯ entries (`def.menuItems(p)`), checked. */
  function counterMenuExtras(p) {
    var def = counterCraftDef(p && p.craft);
    if (!def || typeof def.menuItems !== 'function') return [];
    var extra = [];
    try { extra = def.menuItems(p, ctx) || []; } catch (e) { extra = []; }
    if (!Array.isArray(extra)) return [];
    return extra.filter(function (it) { return it && typeof it.run === 'function' && it.label; })
      .map(function (it) { return { icon: it.icon || '•', label: it.label, run: it.run }; });
  }

  /** Wave H: the counter tour, or the counter craft's own when it registered one. */
  function counterTourId(p) {
    var def = counterCraftDef(p && p.craft);
    var want = def ? def.tourId || def.id : null;
    if (want && tourAvailable()) {
      try {
        if (window.Tour.list().some(function (t) { return t.id === want; })) return want;
      } catch (e) { /* the counter tour */ }
    }
    return 'counter';
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
        run: function () { saveProjectAsTemplate(p); }
      },
      { icon: '❓', label: 'Show me around', run: function () { startTour(counterTourId(p)); } }
    ];
    if (!isCraftProject(p)) {
      var at = items.length - 1;
      // Wave H: a counter craft's own entries (knitting's Glossary) sit
      // above the file items, below Save as template.
      counterMenuExtras(p).forEach(function (it) { items.splice(at++, 0, it); });
      // wave K (P13): what a tap counts on long rows, for this project
      if (isKnit(p)) {
        var unitNow = knitTapUnit(p);
        items.splice(at++, 0, {
          icon: '🔢',
          label: unitNow === 'repeat' ? 'Long rows: a tap counts a repeat (switch to stitches)'
            : 'Long rows: a tap counts a stitch (switch to repeats)',
          run: function () {
            var next = knitTapUnit(p) === 'repeat' ? 'stitch' : 'repeat';
            setKnitTapUnit(p, next);
            render();
            toast(next === 'repeat' ? 'On long rows a tap counts a whole repeat — hold for one stitch'
              : 'A tap counts one stitch again');
          }
        });
      }
      fileMenuItems(p).forEach(function (it) { items.splice(at++, 0, it); });
    }
    openSheet({
      subject: projectId,
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

  /*
   * A backup is one `.thready` file (12 #4): backup.json + the page images +
   * a manifest, built by Store.exportThready. When the zip writer is missing
   * or fails, the plain JSON backup is written instead — still a backup.
   */

  function dateStamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function backupFilename(ext) {
    return 'thready-or-not-backup-' + dateStamp() + '.' + (ext || 'thready');
  }

  /** "Sleepy Sheep!" → "sleepy-sheep-2026-10-03.thready" */
  function projectFilename(p, ext) {
    var slug = String((p && p.name) || 'project').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
    return slug + '-' + dateStamp() + '.' + (ext || 'thready');
  }

  function jsonBackupFile(projectId) {
    try {
      var text = projectId ? Store.exportProjectJSON(projectId) : Store.exportJSON();
      if (!text) return null;
      return {
        blob: new Blob([text], { type: 'application/json' }),
        filename: projectId ? projectFilename(Store.project(projectId), 'json') : backupFilename('json'),
        images: 0,
        kind: 'json'
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * @param {string} [projectId]  one project (12 #5) instead of everything
   * @returns {Promise<{blob, filename, images, kind}|null>}
   */
  function buildBackupFile(projectId) {
    try { Store.flush(); } catch (e) { /* the export reads the in-memory state anyway */ }
    // wave K (shell-data §4): heavy craft data read back first, so a .json fallback is whole too
    var ready = typeof Store.hydrateAll === 'function'
      ? Promise.resolve(Store.hydrateAll()).then(null, noop) : Promise.resolve();
    if (typeof Store.exportThready !== 'function' || !window.Zip) {
      return ready.then(function () { return jsonBackupFile(projectId); });
    }
    return Store.exportThready({ projectId: projectId || null, appVersion: APP_VERSION }).then(function (res) {
      return {
        blob: res.blob,
        filename: projectId ? projectFilename(Store.project(projectId)) : backupFilename('thready'),
        images: res.images,
        kind: 'thready'
      };
    }, function () {
      return ready.then(function () { return jsonBackupFile(projectId); });
    });
  }

  /** Share sheet where the browser can share this file, download otherwise. */
  function deliverFile(f, title) {
    var file = null;
    try {
      file = new File([f.blob], f.filename, { type: f.blob.type || 'application/octet-stream' });
    } catch (e) {
      file = null;
    }
    var shareable = false;
    if (file && navigator.share && navigator.canShare) {
      try { shareable = navigator.canShare({ files: [file] }); } catch (e) { shareable = false; }
    }
    if (!shareable) return Promise.resolve(downloadBlob(f.blob, f.filename) ? 'downloaded' : 'failed');
    return navigator.share({ files: [file], title: title }).then(function () {
      return 'shared';
    }, function (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // NotAllowedError: the zip took long enough that the tap no longer
      // counts as a gesture. The file is ready, so just save it.
      return downloadBlob(f.blob, f.filename) ? 'downloaded' : 'failed';
    });
  }

  var backupBusy = false;

  /** The full backup. Resolves true when a file was handed over. */
  function exportBackup(viaShare) {
    if (backupBusy) return Promise.resolve(false);
    backupBusy = true;
    return buildBackupFile(null).then(function (f) {
      if (!f) return 'failed';
      if (viaShare === true) return deliverFile(f, 'Thready or Not backup').then(function (how) { return { how: how, f: f }; });
      return { how: downloadBlob(f.blob, f.filename) ? 'downloaded' : 'failed', f: f };
    }).then(function (r) {
      backupBusy = false;
      if (!r || r === 'failed' || r.how === 'failed') {
        toast('Could not create the backup file');
        return false;
      }
      if (r.how === 'cancelled') return false;
      var what = r.how === 'shared' ? 'Backup shared' : 'Backup downloaded';
      toast(r.f.images ? what + ' · ' + plural(r.f.images, 'page image') : what);
      return true;
    }, function () {
      backupBusy = false;
      toast('Could not create the backup file');
      return false;
    });
  }

  /** "Send this project" (12 #5): the same container, one project in it. */
  function exportProject(projectId) {
    var p = Store.project(projectId);
    if (!p) return Promise.resolve(false);
    return buildBackupFile(projectId).then(function (f) {
      if (!f) {
        toast('Could not create the project file');
        return false;
      }
      return deliverFile(f, p.name).then(function (how) {
        if (how === 'failed') toast('Could not create the project file');
        else if (how === 'shared' || how === 'downloaded') {
          toast('“' + p.name + '” saved as ' + f.filename + (f.images ? ' · ' + plural(f.images, 'page image') : ''), { ms: 4200 });
        }
        return how === 'shared' || how === 'downloaded';
      });
    });
  }

  /** The file entries in every project's ⋯ menu. */
  function fileMenuItems(p) {
    return [
      // wave K: a picture card of the project, for every craft (shell-ui.md §3)
      { icon: '🖼️', label: 'Share a picture', run: function () { openShareCard(p.id); } },
      { icon: '📦', label: 'Send this project', run: function () { exportProject(p.id); } },
      { icon: '📂', label: 'Open a project file', run: function () { importBackup(); } },
      { icon: '📤', label: 'Back up everything', run: function () { exportBackup(); } }
    ];
  }

  function canShareBackup() {
    if (!navigator.share || !navigator.canShare || typeof window.File !== 'function') return false;
    try {
      var probe = new File([new Blob(['PK'], { type: 'application/zip' })], 'probe.thready', {
        type: 'application/zip'
      });
      return navigator.canShare({ files: [probe] });
    } catch (e) {
      return false;
    }
  }

  function shareBackup() {
    return exportBackup(true);
  }

  /** "Last backup: 3 days ago" for the Settings sheet (13 / 12 #1). */
  function lastBackupText() {
    var status = null;
    try { status = Store.backupStatus(); } catch (e) { status = null; }
    var last = status && status.lastBackupAt;
    if (!last) return 'Last backup: never';
    var dayStart = function (ts) {
      var d = new Date(ts);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    };
    var days = Math.round((dayStart(Date.now()) - dayStart(last)) / 86400000);
    if (days <= 0) return 'Last backup: today';
    if (days === 1) return 'Last backup: yesterday';
    return 'Last backup: ' + days + ' days ago';
  }

  /* ---- import: preview first, then choose (09 #3, 12 #3) ---- */

  function fmtBackupDate(ts) {
    if (!ts) return 'never';
    return fmtClock(ts);
  }

  /** The default each row starts on, per 12 #3. */
  function defaultChoice(row) {
    if (row.status === 'new') return 'replace';   // nothing local: just import
    if (row.status === 'replace') return 'replace'; // the file is newer
    return 'skip';                                  // identical, or local is newer
  }

  /**
   * "Projects: 1 new · 1 newer in the file · 5 already here". Wave E: this
   * used to be one line of `preview.counts`, which adds projects AND
   * templates — the built-in ones included — so a backup of seven projects
   * read "1 new · 1 will be replaced · 17 identical · 0 older", a number that
   * matched nothing on the screen. Now it counts each list it sits above, and
   * leaves out the zeroes.
   */
  function countsFor(rows) {
    var c = { 'new': 0, replace: 0, identical: 0, older: 0 };
    rows.forEach(function (r) { if (c[r.status] !== undefined) c[r.status]++; });
    var bits = [];
    if (c['new']) bits.push(c['new'] + ' new');
    if (c.replace) bits.push(c.replace + ' newer in the file');
    if (c.older) bits.push(c.older + ' older in the file');
    if (c.identical) bits.push(c.identical + ' already here');
    return bits.join(' · ');
  }

  function countsLine(preview) {
    var lines = [];
    var pl = countsFor(preview.projects || []);
    // Built-in templates are in every backup and on every phone; they only
    // count when the file changes one.
    var tl = countsFor((preview.templates || []).filter(function (r) {
      return !(r.builtIn && r.status === 'identical');
    }));
    if (pl) lines.push('Projects: ' + pl);
    if (tl) lines.push('Templates: ' + tl);
    return lines.join('\n') || 'Nothing in this file.';
  }

  function importRow(row, choices, label) {
    var item = el('div', 'imp-row');
    var main = el('div', 'imp-row-main');
    main.appendChild(el('div', 'imp-row-name', row.name || '(unnamed)'));
    var meta = [];
    if (label) meta.push(label);
    // The craft's own name ("Cross-stitch"), not its id ("crossstitch").
    if (row.craft) meta.push(craftInfo(row.craft).name);
    meta.push('in the file: ' + fmtBackupDate(row.updatedAt));
    meta.push('on this phone: ' + (row.localUpdatedAt ? fmtBackupDate(row.localUpdatedAt) : 'not here yet'));
    if (row.pages) meta.push(plural(row.pages, 'page image'));
    main.appendChild(el('div', 'imp-row-meta', meta.join(' · ')));
    item.appendChild(main);

    // Nothing here to replace or keep two of: it is in or it is out.
    var options = row.status === 'new'
      ? [{ id: 'skip', label: 'Skip' }, { id: 'replace', label: 'Import' }]
      : [
          { id: 'skip', label: 'Skip' },
          { id: 'replace', label: 'Replace' },
          { id: 'keepBoth', label: 'Keep both' }
        ];
    var seg = segmented(options, choices[row.id], function (v) { choices[row.id] = v; });
    seg.node.setAttribute('aria-label', 'What to do with ' + (row.name || 'this item'));
    item.appendChild(seg.node);
    return item;
  }

  /**
   * @param {{kind, scope, text, pages, skipped}} read  Store.readBackupFile
   * @param {object} preview  Store.previewImport(read.text, read.pages)
   */
  function openImportPreviewSheet(read, preview) {
    var text = read.text;
    var pages = Array.isArray(read.pages) ? read.pages : [];
    var choices = { projects: Object.create(null), templates: Object.create(null) };
    preview.projects.forEach(function (r) { choices.projects[r.id] = defaultChoice(r); });
    preview.templates.forEach(function (r) { choices.templates[r.id] = defaultChoice(r); });

    openSheet({
      title: read.scope === 'project' && preview.projects.length === 1 ? 'Import this project?' : 'Import this backup?',
      cls: 'sheet-import-preview',
      build: function (body) {
        countsLine(preview).split('\n').forEach(function (line) {
          body.appendChild(el('p', 'imp-counts', line));
        });

        var changedProjects = preview.projects.filter(function (r) { return r.status !== 'identical'; });
        var changedTemplates = preview.templates.filter(function (r) { return r.status !== 'identical'; });

        if (!changedProjects.length && !changedTemplates.length) {
          body.appendChild(el('p', 'muted', 'Everything in this file is already on this phone.'));
        }

        if (changedProjects.length) {
          var pl = el('div', 'imp-rows');
          changedProjects.forEach(function (r) { pl.appendChild(importRow(r, choices.projects)); });
          body.appendChild(field('Projects', pl));
        }
        if (changedTemplates.length) {
          var tl = el('div', 'imp-rows');
          changedTemplates.forEach(function (r) { tl.appendChild(importRow(r, choices.templates, 'template')); });
          body.appendChild(field('Templates', tl));
        }

        // wave K (00 gap 18; shell-data.md §3): the backup's settings come back
        // too — theme, feedback, each craft's settings and the profile — when ticked
        var sp = preview.settings;
        if (sp && sp.present) {
          choices.settings = 'merge';
          var sw = el('label', 'restore-settings');
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = true;
          cb.className = 'check';
          cb.setAttribute('data-restore-settings', '1');
          on(cb, 'change', function () { choices.settings = cb.checked ? 'merge' : 'skip'; });
          sw.appendChild(cb);
          var stext = el('span', 'restore-settings-text');
          var nChanges = typeof sp.count === 'number' ? sp.count : (Array.isArray(sp.changes) ? sp.changes.length : 0);
          stext.appendChild(el('span', 'imp-name', 'Settings'));
          var labels = Array.isArray(sp.changes) ? sp.changes.slice(0, 4).map(function (c) { return c.label || c.key; }) : [];
          stext.appendChild(el('span', 'muted', ' — ' + (nChanges
            ? plural(nChanges, 'change') + (labels.length ? ': ' + labels.join(', ') + (nChanges > labels.length ? '…' : '') : '')
            : 'the same as this phone') + '. Theme, feedback, each craft’s settings and your profile.'));
          sw.appendChild(stext);
          body.appendChild(sw);
        }

        if (pages.length) {
          // Only the projects that are imported bring theirs (a skipped
          // project's images stay in the file), so the count is the file's.
          body.appendChild(el('p', 'muted', 'This file has ' + plural(pages.length, 'page image') +
            '; each project you import brings its own back.'));
        } else if (read.kind === 'json') {
          body.appendChild(el('p', 'muted', 'This is a JSON backup, so it has no page images; a project you already have keeps the ones on this phone.'));
        }
        if (read.skipped) {
          body.appendChild(el('p', 'muted', plural(read.skipped, 'page image') + ' in the file could not be read and will be left out.'));
        }
        body.appendChild(
          el('p', 'muted', 'A “Keep both” copy gets its own copy of the page images.')
        );
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Import',
          cls: 'btn primary',
          onClick: function (api) {
            var n;
            try {
              n = Store.importJSON(text, choices);
            } catch (err) {
              api.close();
              toast(importErrorText(err), { ms: 5200 });
              return;
            }
            api.close();
            applyTheme(Store.settings().theme, false);
            render();
            // Wave E: a templates-only import said "Imported 0 projects".
            var tplsIn = preview.templates.filter(function (r) {
              return r.status !== 'identical' && choices.templates[r.id] && choices.templates[r.id] !== 'skip';
            }).length;
            var what = [];
            if (n || !tplsIn) what.push(plural(n, 'project'));
            if (tplsIn) what.push(plural(tplsIn, 'template'));
            // Page images go to IndexedDB after the state is in (12 #4); the
            // toast waits for them so it can say how many came back.
            var pagesDone = typeof Store.importPages === 'function'
              ? Store.importPages(pages)
              : Promise.resolve({ written: 0, copied: 0 });
            pagesDone.then(null, function () { return { written: 0, copied: 0 }; }).then(function (pr) {
              var images = (pr && (pr.written + pr.copied)) || 0;
              if (images) render();
              toast('Imported ' + what.join(' and ') + (images ? ' · ' + plural(images, 'page image') : ''), {
                ms: 8000,
                actionText: Store.canUndoImport() ? 'Undo import' : '',
                onAction: Store.canUndoImport()
                  ? function () {
                      if (!Store.undoImport()) {
                        toast('That import can no longer be undone');
                        return;
                      }
                      applyTheme(Store.settings().theme, false);
                      render();
                      toast('Import undone');
                      // The page images follow the state back.
                      if (typeof Store.pagesIdle === 'function') Store.pagesIdle().then(function () { render(); });
                    }
                  : null
              });
            });
          }
        }
      ]
    });
  }

  function importErrorText(err) {
    if (err && err.code === 'newerVersion') {
      return 'This backup was made by a newer version. Update the app, then try again.';
    }
    return (err && err.message) || 'That backup could not be imported';
  }

  function importBackup() {
    var input = document.createElement('input');
    input.type = 'file';
    // iOS does not know the .thready extension and greys such a file out
    // under any accept filter; the file is sniffed by its bytes anyway.
    if (!isIOSDevice()) input.accept = '.thready,.json,application/json,application/zip';
    input.style.display = 'none';
    document.body.appendChild(input);
    on(input, 'change', function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (file) importBackupFile(file);
    });
    input.click();
  }

  /**
   * A chosen `.thready` or `.json` file → the preview sheet. Exposed as
   * App.__importBackupFile for QA (a File can be built in the console).
   * @returns {Promise<boolean>} true when the preview sheet opened
   */
  function importBackupFile(file) {
    // A wrong file (a video, a disk image) would otherwise hang the main
    // thread while it is read.
    var tooBig = typeof Store.backupFileProblem === 'function'
      ? Store.backupFileProblem(file && file.size)
      : null;
    if (tooBig) {
      toast(tooBig, { ms: 5200 });
      return Promise.resolve(false);
    }
    if (typeof Store.readBackupFile !== 'function') {
      toast('This copy of the app cannot read backup files');
      return Promise.resolve(false);
    }
    return Store.readBackupFile(file).then(function (read) {
      // Only backup.json reaches localStorage; page images go to IndexedDB,
      // so the quota pre-flight is about the JSON, not the whole zip.
      return guardQuota({ size: read.text.length }, 'that backup').then(function (ok) {
        if (!ok) return false;
        var preview;
        try {
          preview = Store.previewImport(read.text, read.pages);
        } catch (err) {
          toast(importErrorText(err), { ms: 5200 });
          return false;
        }
        openImportPreviewSheet(read, preview);
        return true;
      });
    }, function (err) {
      toast(importErrorText(err), { ms: 5200 });
      return false;
    });
  }

  /* ================================================================== *
   * 19b. Share a picture (wave K, shell-ui.md §3; js/sharecard.js)
   *
   * A square card of the project — name, craft, time from the timer, dates,
   * progress and the craft's own picture — drawn on the device in the
   * current theme and sent through the share sheet, else downloaded.
   * Crochet and knitting get a still of the 3D piece; a craft module hands
   * its own picture through `def.sharePicture(project, {size})`.
   * ================================================================== */

  /** `{text, pct}` for the card's bar: a craft's own, else the counter's rows. */
  function shareProgress(p) {
    var text = projectSummary(p) || '';
    var def = craftFor(p) || counterCraftDef(p.craft);
    if (def && typeof def.shareProgress === 'function') {
      try {
        var r = def.shareProgress(p);
        if (r && typeof r === 'object') return { text: r.text || text, pct: typeof r.pct === 'number' ? r.pct : null };
      } catch (e) { /* the summary line */ }
    }
    if (isCraftProject(p)) {
      var m = /(\d{1,3})\s?%/.exec(text);
      return { text: text, pct: m ? Math.min(100, +m[1]) / 100 : null };
    }
    var want = 0, have = 0;
    (p.parts || []).forEach(function (q) {
      if (!q.targetRows) return;
      var mk = Math.max(1, q.makeCount || 1);
      want += mk * q.targetRows;
      have += Math.min(mk, q.piecesDone || 0) * q.targetRows + (q.piecesDone >= mk ? 0 : Math.min(q.row || 0, q.targetRows));
    });
    return { text: text, pct: want ? have / want : null };
  }

  /**
   * A still of the 3D piece on its own short-lived canvas (fit for viewing,
   * finished look when it is finished), copied to a 2D canvas in the frame
   * it was drawn. Null when there is no piece, no WebGL or no frame comes
   * (a hidden pane): the card then shows the project's emoji.
   */
  function snapshot3D(p, size) {
    if (!diagramAvailable() || !window.Diagram || typeof window.Diagram.mount !== 'function') return Promise.resolve(null);
    var cp = currentProject();
    if (!cp || cp.id !== p.id || isCraftProject(p)) return Promise.resolve(null);
    var model = currentModel();
    // wave K (K1): a knitter who looks at the whole piece shares the whole piece
    var whole = viewerWholeOn(p) ? assembledFor(p, true) : null;   // fresh: today's progress
    if (whole && whole.model) model = whole.model;
    if (!model) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var c = document.createElement('canvas');
      c.className = 'share-snap-canvas';
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + size + 'px;height:' + size + 'px;pointer-events:none;';
      document.body.appendChild(c);
      var handle = null, done = false, frames = 0;
      function finish(out) {
        if (done) return;
        done = true;
        try { if (handle) handle.destroy({ release: true }); } catch (e) { /* ignore */ }
        if (c.parentNode) c.parentNode.removeChild(c);
        resolve(out);
      }
      try {
        handle = window.Diagram.mount(c, {
          palette: diagramPalette(), reducedMotion: true, interactive: false,
          fitPurpose: 'viewer', finished: modelFinished(model), follow: false
        });
        handle.setModel(model, { animate: 'none', fitPurpose: 'viewer', finished: whole ? !!model.finished : modelFinished(model) });
        if (typeof handle.resize === 'function') handle.resize();
      } catch (e) {
        finish(null);
        return;
      }
      /* wave K (knit-3d): the renderer draws one frame synchronously and hands
         back the piece cropped (works on a hidden page); the frame-copy below
         stays as the fallback for an older diagram.js */
      var snap = window.ShareCard && typeof window.ShareCard.snapshot === 'function'
        ? window.ShareCard.snapshot(handle, { size: size, crop: true, pad: 0.06 }) : null;
      if (snap) { finish(snap); return; }
      function grab() {
        if (done) return;
        frames++;
        var out = document.createElement('canvas');
        out.width = c.width || size;
        out.height = c.height || size;
        var g = out.getContext('2d');
        var ink = false, box = null;
        try {
          g.drawImage(c, 0, 0);
          var W = out.width, H = out.height;
          var px = g.getImageData(0, 0, W, H).data;
          // the inked box, sampled every 3 px, so the card shows the piece, not the empty frame
          var x0 = W, y0 = H, x1 = -1, y1 = -1;
          for (var y = 0; y < H; y += 3) {
            for (var x = 0; x < W; x += 3) {
              if (px[(y * W + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
              }
            }
          }
          ink = x1 >= x0 && y1 >= y0;
          if (ink) {
            var m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.08) + 6;
            box = { x: Math.max(0, x0 - m), y: Math.max(0, y0 - m) };
            box.w = Math.min(W, x1 + m) - box.x;
            box.h = Math.min(H, y1 + m) - box.y;
          }
        } catch (e) { ink = false; }
        if (ink && box && box.w > 8 && box.h > 8) {
          var crop = document.createElement('canvas');
          crop.width = box.w;
          crop.height = box.h;
          crop.getContext('2d').drawImage(out, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
          finish(crop);
          return;
        }
        if (ink) { finish(out); return; }
        if (frames > 12) { finish(null); return; }
        window.requestAnimationFrame(grab);
      }
      window.requestAnimationFrame(function () { window.requestAnimationFrame(grab); });
      // a hidden pane never paints a frame: give up and use the emoji
      window.setTimeout(function () { finish(null); }, 2500);
    });
  }

  function sharePictureOf(p, size) {
    var def = craftFor(p) || counterCraftDef(p.craft);
    if (def && typeof def.sharePicture === 'function') {
      try {
        return Promise.resolve(def.sharePicture(p, { size: size })).then(function (x) { return x || null; }, function () { return null; });
      } catch (e) {
        return Promise.resolve(null);
      }
    }
    if (!isCraftProject(p)) return snapshot3D(p, size);
    return Promise.resolve(null);
  }

  function shareInfo(p, picture) {
    var info = craftInfo(p.craft);
    var prog = shareProgress(p);
    var parts = (p.parts || []).length > 1 && !isCraftProject(p)
      ? [p.parts.slice(0, 4).map(function (q) { return q.name + (q.makeCount > 1 ? ' ×' + q.makeCount : ''); }).join(' · ') + (p.parts.length > 4 ? ' …' : '')]
      : [];
    return {
      name: p.name, emoji: p.emoji, craft: info, status: p.status,
      startedAt: p.createdAt, finishedAt: p.finishedAt, elapsedMs: Store.elapsedMs(p),
      progress: p.status === 'finished' ? { text: 'Finished', pct: 1 } : prog,
      lines: parts, picture: picture
    };
  }

  /** ⋯ → Share a picture: a preview, then Share (or Save picture where sharing is unavailable). */
  function openShareCard(projectId) {
    var p = Store.project(projectId);
    if (!p || !window.ShareCard) {
      toast('Pictures are unavailable right now');
      return null;
    }
    var size = 1080;
    var canvas = document.createElement('canvas');
    canvas.className = 'share-card-canvas';
    canvas.setAttribute('role', 'img');
    var blob = null;
    var status = el('p', 'muted share-card-status', 'Drawing the card…');
    status.setAttribute('aria-live', 'polite');
    var shareBtnNode = null;
    function paint(picture) {
      var info = shareInfo(Store.project(projectId) || p, picture);
      window.ShareCard.draw(canvas, info, { size: size, theme: window.ShareCard.theme(null) });
      canvas.setAttribute('aria-label', 'Picture card: ' + window.ShareCard.textLines(info).concat([info.name]).join('. '));
      return window.ShareCard.toBlob(canvas).then(function (b) {
        blob = b;
        status.textContent = b ? 'Ready. Nothing leaves this device unless you share it.' : 'The picture could not be made.';
        if (shareBtnNode) shareBtnNode.disabled = !b;
      });
    }
    paint(null);
    sharePictureOf(p, 900).then(function (pic) { if (pic) paint(pic); });
    var canFiles = false;
    try {
      canFiles = !!(navigator.share && navigator.canShare && typeof File === 'function' &&
        navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' })] }));
    } catch (e) { canFiles = false; }
    return openSheet({
      subject: projectId,
      title: 'Share a picture',
      cls: 'sheet-share-card',
      build: function (body) {
        var wrap = el('div', 'share-card-wrap');
        wrap.appendChild(canvas);
        body.appendChild(wrap);
        body.appendChild(status);
      },
      footer: [
        { text: 'Close', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: canFiles ? '📤 Share' : '📥 Save picture',
          cls: 'btn primary',
          onClick: function () {
            if (!blob) { toast('Still drawing — one moment'); return; }
            var info = shareInfo(Store.project(projectId) || p, null);
            window.ShareCard.share(blob, {
              filename: window.ShareCard.fileName(info),
              title: info.name,
              text: info.name + ' · ' + info.craft.name
            }).then(function (r) {
              if (r === 'downloaded') toast('Picture saved');
              else if (r === 'failed') toast('The picture could not be saved');
            });
          }
        }
      ]
    });
  }

  /* ================================================================== *
   * 19c. The opt-in text reader (wave K, docs/wave-k/ocr.md; js/ocr.js)
   *
   * Nothing downloads until the maker asks: a craft offers "Try reading
   * this scanned page (downloads about 5 MB once)", or Settings → Read
   * scanned pages → Download. The engine then lives in its own Cache Storage
   * bucket (thready-ocr-*, kept by sw.js across deploys) and works offline.
   * OCR text is never trusted silently: everything it read is shown as
   * "read from a picture — check it" (ctx.ocr.mark / ctx.ocr.check).
   * ================================================================== */

  var OCR_LABEL = 'Read from a picture — check it';

  function ocrApi() {
    return window.Ocr && typeof window.Ocr.available === 'function' && window.Ocr.available() ? window.Ocr : null;
  }

  function mbText(bytes) {
    var mb = (Number(bytes) || 0) / 1048576;
    return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
  }

  /** "about 5 MB" (the manifest's own words), for every button that downloads. */
  function ocrSizeLabel() {
    var O = ocrApi();
    var s = O && typeof O.downloadSize === 'function' ? O.downloadSize() : null;
    return s && s.label ? s.label : 'about 5 MB';
  }

  /**
   * Make sure the reader is on this device, asking first. Resolves true when
   * it is installed (at once if it already was), false when the maker
   * declines or cancels. The sheet shows the size before anything moves,
   * then "Getting the text reader… 2.1 of 4.9 MB" with Cancel.
   */
  function ocrEnsure(opts) {
    opts = opts || {};
    var O = ocrApi();
    if (!O) {
      toast('This browser cannot run the text reader');
      return Promise.resolve(false);
    }
    return Promise.resolve(O.installed()).then(function (have) {
      if (have) return true;
      return new Promise(function (resolve) {
        var settled = false, ctl = null;
        function done(v) { if (!settled) { settled = true; resolve(v); } }
        openSheet({
          title: 'Read scanned pages',
          cls: 'sheet-ocr',
          build: function (body, api) {
            body.appendChild(el('p', null, (opts.reason ? opts.reason + ' ' : '') +
              'The text reader is a one-time download of ' + ocrSizeLabel() + '. It stays on this device, ' +
              'works offline, and sends nothing anywhere. You can remove it in Settings.'));
            body.appendChild(el('p', 'muted', 'What it reads is marked “read from a picture — check it”: ' +
              'a scan can be misread, so check it against the page.'));
            var prog = el('div', 'progress ocr-progress');
            prog.hidden = true;
            var bar = el('div', 'bar');
            var fill = el('div', 'bar-fill');
            bar.appendChild(fill);
            prog.appendChild(bar);
            var lbl = el('div', 'bar-label');
            lbl.setAttribute('aria-live', 'polite');
            prog.appendChild(lbl);
            prog.setAttribute('role', 'progressbar');
            prog.setAttribute('aria-label', 'Getting the text reader');
            body.appendChild(prog);
            var go = button('btn primary block ocr-download', 'Download (' + ocrSizeLabel() + ')');
            var cancel = button('btn ghost block', 'Not now');
            on(go, 'click', function () {
              go.disabled = true;
              prog.hidden = false;
              cancel.textContent = 'Cancel';
              ctl = { cancelled: false, aborted: false };
              lbl.textContent = 'Getting the text reader…';
              O.install({
                signal: ctl,
                onProgress: function (p) {
                  var f = p && p.total ? p.loaded / p.total : (p && p.fraction) || 0;
                  fill.style.width = Math.round(f * 100) + '%';
                  prog.setAttribute('aria-valuenow', String(Math.round(f * 100)));
                  lbl.textContent = 'Getting the text reader… ' + mbText(p && p.loaded) + ' of ' + mbText(p && p.total);
                }
              }).then(function () {
                toast('The text reader is ready');
                announce('The text reader is ready');
                done(true);
                api.close();
              }, function (err) {
                if (err && err.name === 'AbortError') { lbl.textContent = 'Stopped. Nothing half-done was kept.'; }
                else lbl.textContent = 'The download did not finish. Check the connection and try again.';
                go.disabled = false;
                go.textContent = 'Try again (' + ocrSizeLabel() + ')';
              });
            });
            on(cancel, 'click', function () {
              if (ctl) { ctl.cancelled = true; ctl.aborted = true; }
              done(false);
              api.close();
            });
            body.appendChild(go);
            body.appendChild(cancel);
          },
          onClose: function () {
            if (ctl && !settled) { ctl.cancelled = true; ctl.aborted = true; }
            done(false);
          }
        });
      });
    }, function () { return false; });
  }

  /**
   * The button a craft puts beside a page it could not read:
   * "Try reading this scanned page (downloads about 5 MB once)" — or without
   * the download note once the reader is here. On tap it gets the reader
   * (asking first) and calls `opts.onReady(Ocr)`; the craft reads the page.
   */
  function ocrOfferButton(opts) {
    opts = opts || {};
    var O = ocrApi();
    var text = opts.text || 'Try reading this scanned page';
    var b = button('btn ocr-offer' + (opts.cls ? ' ' + opts.cls : ''), text + ' (downloads ' + ocrSizeLabel() + ' once)');
    if (!O) {
      b.hidden = true;
      return b;
    }
    Promise.resolve(O.installed()).then(function (have) { if (have) b.textContent = text; }, noop);
    on(b, 'click', function () {
      ocrEnsure({ reason: opts.reason }).then(function (ok) {
        if (!ok) return;
        b.textContent = text;
        if (typeof opts.onReady === 'function') {
          try { opts.onReady(window.Ocr); } catch (e) { toast('The page could not be read'); }
        }
      });
    });
    return b;
  }

  /** Mark a node as OCR text: a ? badge and "Read from a picture — check it". */
  function ocrMark(node, opts) {
    opts = opts || {};
    if (!node || !node.classList) return node;
    node.classList.add('ocr-read');
    node.setAttribute('data-ocr', '1');
    if (!node.querySelector(':scope > .ocr-flag')) {
      var flag = el('span', 'ocr-flag');
      flag.appendChild(window.CheckSheet ? window.CheckSheet.badge('unknown', { label: 'read from a picture' }) : el('span', null, '?'));
      flag.appendChild(el('span', 'ocr-flag-text', opts.label || OCR_LABEL));
      if (typeof opts.conf === 'number') flag.title = 'Reader confidence ' + Math.round(opts.conf) + ' of 100';
      node.insertBefore(flag, node.firstChild);
    }
    return node;
  }

  /**
   * An OCR result (or its lines) as a Check: every line "?" — nothing read
   * from a picture is ever "✓". Low-confidence lines say so. Feed it to
   * ctx.check.open / line, or a craft's own banner.
   */
  function ocrCheck(result, opts) {
    opts = opts || {};
    var lines = result && Array.isArray(result.lines) ? result.lines : (Array.isArray(result) ? result : []);
    var low = typeof opts.lowConf === 'number' ? opts.lowConf : 60;
    var rows = lines.filter(function (l) { return l && String(l.text || '').trim(); }).map(function (l, i) {
      var c = typeof l.conf === 'number' ? Math.round(l.conf) : null;
      return {
        label: String(l.text).trim().slice(0, 120), printed: null, read: c, verdict: 'unknown',
        why: c !== null && c < low ? 'The reader was unsure here (' + c + ' of 100). Check this line against the page.'
          : 'Read from a picture: check it against the page.',
        page: typeof opts.page === 'number' ? opts.page : (typeof l.page === 'number' ? l.page : null)
      };
    });
    var unsure = rows.filter(function (r) { return r.read !== null && r.read < low; }).length;
    var check = {
      verdict: 'unchecked',
      title: opts.title || 'Read from a picture',
      summary: 'Read from a picture — check every row.' + (unsure ? ' ' + plural(unsure, 'line') + ' the reader was unsure of.' : ''),
      rows: rows,
      note: 'Read: the reader’s confidence, 0–100. Nothing read from a picture is taken as certain.'
    };
    return window.CheckSheet ? window.CheckSheet.normalize(check) : check;
  }

  /** Settings → Read scanned pages: not installed / installed (size), Download with progress, Remove. */
  function ocrSettingsSection() {
    var O = ocrApi();
    var wrap = el('div', 'field ocr-settings');
    wrap.setAttribute('data-settings', 'ocr');
    wrap.appendChild(el('div', 'field-label', 'Read scanned pages'));
    var status = el('p', 'muted ocr-status');
    status.setAttribute('aria-live', 'polite');
    wrap.appendChild(status);
    var row = el('div', 'ocr-actions');
    wrap.appendChild(row);
    wrap.appendChild(el('div', 'field-hint',
      'Optional. Lets the app try to read patterns that are scanned pictures. Everything it reads is marked ' +
      '“check it”. Downloaded once, kept on this device, works offline, sends nothing anywhere.'));
    function paint() {
      clear(row);
      if (!O) {
        status.textContent = 'This browser cannot run the text reader.';
        return;
      }
      status.textContent = 'Checking…';
      Promise.resolve(O.installed()).then(function (have) {
        if (!have) {
          status.textContent = 'Not installed.';
          var dl = button('btn block ocr-download', 'Download (' + ocrSizeLabel() + ' once)');
          on(dl, 'click', function () { ocrEnsure().then(paint); });
          row.appendChild(dl);
          return;
        }
        return Promise.resolve(O.storedBytes()).then(function (bytes) {
          status.textContent = 'Installed · ' + mbText(bytes) + ' on this device.';
          var rm = button('btn block ocr-remove', 'Remove the text reader');
          on(rm, 'click', function () {
            confirmSheet({
              title: 'Remove the text reader?',
              message: 'It frees ' + mbText(bytes) + '. What it already read stays in your projects. You can download it again any time.',
              confirmText: 'Remove',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              Promise.resolve(O.remove()).then(function () {
                toast('Text reader removed');
                paint();
              });
            });
          });
          row.appendChild(rm);
        });
      }, function () { status.textContent = 'Not installed.'; });
    }
    paint();
    return wrap;
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
      q: 'Can I import a PDF when creating a project?',
      a: 'Yes — drop it straight into the New project sheet, under the template picker. The parts it ' +
        'finds are listed there to tick and rename, “From this PDF” appears as a template card, and ' +
        'you can save the lot as a template at the same time so the next one starts with the pattern ' +
        'already in place.'
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
      a: 'Everything lives on this device, in this browser — nothing is uploaded anywhere. Back up now ' +
        '(above) saves one .thready file with every project and its page images, to keep or move to another ' +
        'phone; Import backup reads it back and shows you what will change first. To move a single project, ' +
        'use Send this project in its ⋯ menu.'
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

  /**
   * Wave K (00 gap 17): after the first project in a craft other than
   * crochet, its own tour is offered once, the way crochet's welcome chain
   * offers the counter. Never while a sheet or tour is up; offering marks it
   * seen, so "Not now" is never asked again (Settings → Help still has it).
   */
  function offerCraftTour(craftId) {
    if (!craftId || craftId === CROCHET.id || !tourAvailable()) return;
    var def = craftDefs[craftId];
    var id = def ? def.tourId || def.id : craftId;
    var t = null;
    try {
      window.Tour.list().forEach(function (x) { if (x.id === id) t = x; });
    } catch (e) { t = null; }
    if (!t || t.seen) return;
    var mine = Store.projects().filter(function (q) { return (q.craft || CROCHET.id) === craftId; });
    if (mine.length !== 1) return;
    window.setTimeout(function () {
      if (openSheets.length || (typeof window.Tour.isRunning === 'function' && window.Tour.isRunning())) return;
      if (typeof window.Tour.markSeen === 'function') window.Tour.markSeen(id);
      if (typeof window.Tour.prompt !== 'function') return;
      var info = craftInfo(craftId);
      window.Tour.prompt({
        title: info.emoji + ' Your first ' + info.name.toLowerCase() + ' project',
        body: 'Want a quick look round? It takes about a minute.',
        confirmText: 'Show me',
        cancelText: 'Not now'
      }).then(function (go) {
        if (go) startTour(id);
      }).catch(noop);
    }, 1200);
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

    wrap.appendChild(el('div', 'field-label faq-label', 'Common questions'));
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

  /**
   * Wave K (00 gap 18; shell-data.md §3): Settings → Your profile — the
   * maker's preferred unit, body measurements (every craft reads them:
   * sewing's size advice, knitting's fit), and what the stashes hold (they
   * are filled from the crafts' own screens). Hidden without Store.profile.
   */
  var PROFILE_MEASURES = [
    { key: 'bust', label: 'Bust / chest' },
    { key: 'waist', label: 'Waist' },
    { key: 'hip', label: 'Hip' },
    { key: 'height', label: 'Height' }
  ];

  function profileSection() {
    if (typeof Store.profile !== 'function' || typeof Store.setProfile !== 'function') return null;
    var wrap = el('div', 'field profile-section');
    wrap.setAttribute('data-settings', 'profile');
    wrap.appendChild(el('div', 'field-label', 'Your profile'));
    var pr = Store.profile();
    var unit = pr && pr.units && pr.units.length === 'in' ? 'in' : 'cm';
    var unitSeg = segmented([{ id: 'cm', label: 'Centimetres' }, { id: 'in', label: 'Inches' }], unit, function (v) {
      Store.setProfile({ units: { length: v } });
      redraw();
      fb('tap');
    });
    unitSeg.node.setAttribute('aria-label', 'Measure in centimetres or inches');
    var urow = el('div', 'profile-row');
    urow.appendChild(el('span', 'field-hint', 'Measure in'));
    urow.appendChild(unitSeg.node);
    wrap.appendChild(urow);

    var list = el('div', 'profile-measures');
    wrap.appendChild(list);
    function redraw() {
      clear(list);
      var p2 = Store.profile();
      var u = p2.units && p2.units.length === 'in' ? 'in' : 'cm';
      var keys = PROFILE_MEASURES.slice();
      Object.keys(p2.measurements || {}).forEach(function (k) {
        if (!keys.some(function (m) { return m.key === k; })) keys.push({ key: k, label: k });
      });
      keys.forEach(function (m) {
        var have = typeof Store.measurement === 'function' ? Store.measurement(m.key, u) : null;
        var inp = numInput(have === null ? '' : Math.round(have * 10) / 10, 0, 10000);
        inp.step = '0.1';
        inp.setAttribute('inputmode', 'decimal');
        inp.setAttribute('data-measure', m.key);
        inp.setAttribute('aria-label', m.label + ' in ' + (u === 'in' ? 'inches' : 'centimetres'));
        if (have === null) inp.value = '';
        on(inp, 'change', function () {
          var v = parseFloat(inp.value);
          if (!inp.value.trim() || !isFinite(v) || v <= 0) {
            if (typeof Store.removeMeasurement === 'function') Store.removeMeasurement(m.key);
          } else if (typeof Store.setMeasurement === 'function') {
            Store.setMeasurement(m.key, v, u);
          }
        });
        var row = el('label', 'profile-row');
        row.appendChild(el('span', 'profile-measure-label', m.label));
        row.appendChild(inp);
        row.appendChild(el('span', 'muted', u));
        list.appendChild(row);
      });
      var fl = typeof Store.flossStash === 'function' ? Store.flossStash() : [];
      var fa = typeof Store.fabricStash === 'function' ? Store.fabricStash() : [];
      list.appendChild(el('p', 'field-hint profile-stash',
        'Stash: ' + plural(fl.length, 'floss colour') + ' · ' + plural(fa.length, 'piece') + ' of fabric. ' +
        'Add to them from a cross-stitch or sewing project.'));
    }
    redraw();
    wrap.appendChild(el('div', 'field-hint', 'Kept on this device, used by every craft (sewing sizes, knitting fit). Your backup carries it.'));
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
          switchRow('Sounds', 'Little synthesised clicks and chimes.', s.sounds, function (v) {
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
          // Wave F: the owner's request, on by default (see diagramFollowOn).
          toggles.appendChild(
            switchRow('3D follows your stitches', 'Each tap turns the piece so the stitch you just made faces you.',
              diagramFollowOn(), function (v) {
                setDiagramFollow(v);
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
          newTemplateFlow(function () {
            renderTemplateList(tplList);
          });
        });
        tplField.appendChild(newTpl);
        tplField.appendChild(el('div', 'field-hint', 'Templates set up the parts and checklist of a new project.'));
        body.appendChild(tplField);

        /* ---- Backup ---- */
        var backup = el('div', 'field');
        backup.appendChild(el('div', 'field-label', 'Backup'));
        var lastLine = el('p', 'muted backup-last', lastBackupText());
        lastLine.setAttribute('aria-live', 'polite');
        backup.appendChild(lastLine);
        var refreshLast = function () { lastLine.textContent = lastBackupText(); };
        var exp = button('btn block', '📥 Back up now');
        on(exp, 'click', function () { exportBackup().then(refreshLast); });
        backup.appendChild(exp);
        if (canShareBackup()) {
          var shareBtn = button('btn block', '📤 Share backup');
          on(shareBtn, 'click', function () { shareBackup().then(refreshLast); });
          backup.appendChild(shareBtn);
        }
        var imp = button('btn block', '📂 Import backup');
        on(imp, 'click', importBackup);
        backup.appendChild(imp);
        backup.appendChild(el('div', 'field-hint',
          'A backup is one .thready file with every project, template and page image in it. ' +
          'Import reads a .thready file or an older .json backup, and lets you choose what comes back.'));
        body.appendChild(backup);

        /* ---- Your profile (wave K) ---- */
        var prof = profileSection();
        if (prof) body.appendChild(prof);

        /* ---- Read scanned pages (wave K, opt-in OCR) ---- */
        if (window.Ocr) body.appendChild(ocrSettingsSection());

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
          // Wave H: a craft's own settings (`registerCraft({ settingsFields(body, ctx) })`),
          // one section each, under the craft's name.
          craftOrder.forEach(function (cid) {
            var cdef = craftDefs[cid];
            if (!cdef || typeof cdef.settingsFields !== 'function') return;
            var sec = el('div', 'field craft-settings');
            sec.setAttribute('data-craft-settings', cid);
            var cinfo = craftInfo(cid);
            sec.appendChild(el('div', 'field-label', cinfo.emoji + ' ' + cinfo.name));
            try {
              cdef.settingsFields(sec, ctx);
            } catch (e) {
              return;   // a broken module never breaks Settings
            }
            body.appendChild(sec);
          });
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
      toast('No problem — the tours live in Settings');
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
      var res = Store.untapRow(p.id, prt.id);
      // Nothing to step back off (row 0 of the first piece): no buzz, no
      // announcement, and above all no history entry eaten (13 #4).
      if (res && res.event === 'none') return;
      fb('undo');
      render();
      var back = Store.activePart(p);
      // wave H: "Back to short row 3"
      announce(knitBackText(p, back, res) || ('Back to ' + partRowWord(p, back).toLowerCase() + ' ' + (back.row + 1)));
    });

    // Pattern line
    on(els.patternLine, 'click', function () {
      var p = currentProject();
      var prt = currentPart();
      if (p && prt) openPatternSheet(p.id, prt.id);
    });

    // Stitch controls
    bindStitchButton();
    // wave I: Space / Enter / arrows / Escape in the working mode
    bindWorkKeys();
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
    // Save failures, a corrupt key and a second tab all have to be visible
    // before the first tap (13 #1–#3).
    watchStorage();

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
    openProjectEditor: openProjectEditor,
    openSettingsSheet: openSettingsSheet,
    openChecklistSheet: openChecklistSheet,
    startTour: startTour,
    startWelcomeTour: startWelcomeTour,
    applyTheme: applyTheme,
    // Crafts (docs/CRAFTS.md)
    registerCraft: registerCraft,
    crafts: craftList,
    // wave H: crochet or a usesCounter craft (knitting) → #screen-project
    craftUsesCounter: counterCraft,
    parserOf: parserOf,
    // wave H (knit-counter): ⋯ → Glossary for a knitting project
    openGlossarySheet: openGlossarySheet,
    ctx: ctx,
    pdfDropZone: pdfDropZone,
    // wave K: shared surfaces (docs/wave-k/api/shell-ui.md)
    workMode: workModeApi,
    counted: counted,
    openCheckSheet: openCheckSheet,
    openPageViewer: openPageViewerSheet,
    openShareCard: function (id) { return openShareCard(id); },
    ocr: ctx.ocr,
    version: APP_VERSION,
    /** QA only: open every sheet down the no-`showModal` path (UX sweep D3). */
    __forceSheetFallback: function (on) { forceSheetFallback = !!on; return forceSheetFallback; },
    /** QA only: run a File through Settings → Import backup without a picker. */
    __importBackupFile: importBackupFile,
    /** QA only: the .thready (or JSON fallback) the backup buttons would save. */
    __buildBackupFile: buildBackupFile,
    /** QA only (wave K): the page-image sweep's guard, for test/crafts.test.html. */
    __sweepQa: {
      liveIds: function () { return sweepLiveIds(); },
      otherIds: function () { return otherStoreIds(Store.KEY); },
      run: function () { return runBlobSweep(); },
      bootKey: function () { return sweepBootKey; }
    },
    /** QA only (wave K, P13 / P8): repeat taps and "knit both at once", for test/crafts.test.html. */
    __knitTapQa: {
      units: function (p, prt) { return knitTapUnits(p, prt); },
      step: knitTapStep,
      unit: function (p) { return knitTapUnit(p); },
      setUnit: function (p, u) { setKnitTapUnit(p, u); },
      tap: function (o) { return doStitchTap(o); },
      bothAtOnce: function (id, names) { return applyBothAtOnce(id, names); },
      /** wave K (E12): a chart page inside a book pattern's pages */
      pageInside: knitPageInside,
      keepMaterials: function (id, t, book) { return knitKeepMaterials(id, t, book); },
      projectName: knitProjectName,
      untilChip: function (ui, p, prt) { return untilChipText(ui, p, prt); },
      partWord: function (p, prt) { return partRowWord(p, prt); },
      chartKeys: function () { return KNIT_CHART_KEYS.slice(); },
      /** run the background chart scan on a stand-in handle, as a PDF import would */
      attachWith: function (projectId, handle, within) {
        knitCapture = handle ? { handle: handle, at: Date.now() } : null;
        return knitAttachCharts(projectId, within);
      },
      scanSignal: function () { return knitScanSignal; }
    },
    /** QA only (wave K, K1): the viewer's whole-piece switch, for test/crafts.test.html. */
    __viewerQa: {
      wholeAvailable: function (p) { return wholeAvailable(p); },
      wholeOn: function (p) { return viewerWholeOn(p); },
      setWhole: function (p, v) { setViewerWhole(p, v); },
      assembled: function (p) { return assembledFor(p); },
      caption: function (a) { return assembledCaption(a); },
      open: function () { openViewerSheet(); },
      handle: function () { return viewer.handle; },
      /** the tap path's own push, as a stitch tap makes it */
      push: function () { pushDiagram('stitch'); },
      resized: function () { wholeResized(); },
      /** what every tap used to cost: assemble + setModel, now (for measuring) */
      rebuildNow: function () {
        var p = currentProject();
        assembled.key = '';
        var A = assembledFor(p);
        if (viewer.handle && A && A.model) viewer.handle.setModel(A.model, { animate: 'none', fitPurpose: 'viewer', finished: !!A.model.finished });
        return A;
      }
    },
    /** QA only (wave H, knit-qa): the pure helpers test/knit-counter.test.html asserts. */
    __knitQa: {
      gaugeChipText: gaugeChipText,
      chartMentioned: knitChartMentioned,
      groupNoun: groupNoun,
      groupLabel: groupLabel,
      shapeName: shapeName
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
