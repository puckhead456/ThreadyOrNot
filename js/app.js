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
      var url = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
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
  function iosNotInstalled() {
    var ua = String(navigator.userAgent || '');
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return false;
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
    var save = button('btn small primary', 'Download backup');
    on(save, 'click', function () {
      exportBackup();
      renderHome();
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
      var allDone = el('p', 'muted home-all-done', 'Nothing on the hook right now — everything you have made is on the shelf below.');
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
          body.appendChild(el('p', null, p.name + ' is off the hook. Time for assembly.'));
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

  /** Once per part per session — the guard is a nudge, not a nag. */
  var alreadyDoneSaid = Object.create(null);

  function applyResult(res) {
    if (!res || res.event === 'none') return;
    var p = currentProject();
    if (!p) return;
    var prt = Store.activePart(p);

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
  var DIAGRAM_MAX_LIVE_ROWS = 250;
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
   * Push the current model at whatever is mounted.
   * @param {'stitch'|'round'|'none'} animate
   */
  function pushDiagram(animate) {
    if (!live.handle && !viewer.handle) return;
    // Nothing but the deliberately-opened viewer pays for a heavy piece.
    if (!viewer.handle && partIsHeavy(currentPart())) return;
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

  /** Just the canvas and its renderer; the "3D view" button stays. */
  function destroyLiveCanvas() {
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
    els.stitchBtn.classList.add('has-diagram');
    resizeDiagrams();
    pushDiagram('none');
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
    var b = button('btn stitch-3d', null, 'Open the 3D view');
    b.id = 'stitch-3d';
    b.setAttribute('data-tour', 'stitch-3d');
    b.appendChild(el('span', 'stitch-3d-glyph', '⤢'));
    b.appendChild(el('span', 'stitch-3d-label', '3D view'));
    on(b, 'click', function (e) {
      e.stopPropagation();
      openViewerSheet();
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
      subject: p.id,
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
    var modeField, groupField, craftFieldsWrap, craftFieldsApi, pdfWrap;
    var pdf = null;

    /* Rows/Rounds and the stitch group size only mean something to crochet. */
    function syncCraftOnlyFields() {
      var crochet = chosenCraft === 'crochet';
      if (modeField) modeField.hidden = !crochet;
      if (groupField) groupField.hidden = !crochet;
      // Importing a crochet pattern into a cross-stitch project makes no sense;
      // those crafts have their own importers on the project screen.
      if (pdfWrap) pdfWrap.hidden = !crochet;
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

            // A PDF has been read: the sections it found are offered as a
            // synthetic template at the front, and picked by default. Any real
            // template can still be chosen — the sections are then added on top
            // of that template's parts.
            var pdfSecs = pdf && chosenCraft === 'crochet' ? pdf.checkedSections() : [];
            if (pdfSecs.length) {
              var pdfCard = button('tpl-card' + (chosenTemplate === PDF_TEMPLATE_ID ? ' on' : ''));
              pdfCard.setAttribute('data-tour', 'new-pdf-card');
              pdfCard.appendChild(el('span', 'tpl-emoji', '📄'));
              var pdfMain = el('div', 'tpl-main');
              pdfMain.appendChild(el('div', 'tpl-name', pdf.sourceLabel()));
              pdfMain.appendChild(
                el(
                  'div',
                  'tpl-parts',
                  pdfSecs
                    .map(function (s) {
                      return (s.name || 'Part') + (s.makeCount > 1 ? ' ×' + s.makeCount : '');
                    })
                    .join(', ')
                )
              );
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
            function () { return modeSeg ? rowWord({ countMode: modeSeg.get() }) : 'Row'; }
          );
          body.appendChild(pdfWrap);
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
              api.close();
              render();
              return;
            }

            // A PDF read in this sheet: its sections become parts right after
            // the project exists, on top of whatever the template made.
            var secs = pdf && chosenCraft === 'crochet' ? pdf.checkedSections() : [];
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
            if (secs.length) {
              var res = Store.importPatternSections(created.id, secs, {
                mode: 'parts', text: pdf.text(), noTargets: pdf.noTargets()
              });
              var extra = addChecklistItems(created.id, pdf.checkedChecklist());
              var fresh = Store.project(created.id);
              bits.push(plural(fresh ? fresh.parts.length : secs.length, 'part'));
              if (res && res.placed) bits.push('placing notes');
              if (extra) bits.push(plural(extra, 'checklist item'));
              if (pdf.wantsTemplate()) {
                try {
                  Store.saveTemplate({
                    name: pdf.templateName(),
                    emoji: patch.emoji,
                    countMode: patch.countMode,
                    groupSize: patch.groupSize,
                    craft: 'crochet',
                    parts: secs.map(function (s) {
                      return {
                        name: s.name || 'Part',
                        makeCount: s.makeCount,
                        patternText: s.text,
                        placementNotes: s.placement || ''
                      };
                    }),
                    checklist: pdf.checkedChecklist()
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
  function newProjectPdfBlock(host, nameInput, onChange, onRead, rowWordFn) {
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

    var dropZone = pdfDropZone({
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
    });
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
      /** Pasted text gets the same card, under an honest name. */
      sourceLabel: function () { return fileBase ? 'From this PDF' : 'From this pattern'; },
      rerender: function () { picker.rerender(); },
      noTargets: picker.noTargets,
      checkedSections: picker.checkedSections,
      checkedChecklist: picker.checkedChecklist,
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
      subject: projectId,
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
        repStart.placeholder = '5';
        repEnd = numInput(prt.repeat.endRow, 1, 999999);
        repEnd.placeholder = '8';
        repTimes = numInput(prt.repeat.times, 1, 9999);
        repTimes.placeholder = '6';
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
        Store.updatePart(p.id, prt.id, patch);
        api.close();
        render();
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
        // The pattern text rides along through renames, moves and saves; the
        // editor only ever shows a tag for it and offers to drop it.
        return { name: p.name, makeCount: p.makeCount, patternText: typeof p.patternText === 'string' ? p.patternText : '' };
      }),
      checklist: (source.checklist || []).slice()
    };
    if (!model.parts.length) model.parts.push({ name: '', makeCount: 1, patternText: '' });

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

  function sectionRowInfo(text, seq) {
    var probe = { id: 'import:' + seq, patternText: text, sizeIndex: 0 };
    var s = Store.patternSummary(probe);
    return {
      rows: s.rows,
      computedOnly: s.computedOnly,
      hasTargets: s.hasTargets,
      // What Store.importPatternSections will set as targetRows (01 #1). Same
      // rule: rows 1..maxRow, contiguous, at least two of them.
      target: contiguousTarget(probe)
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
      toast((err && err.message) || 'Couldn’t read that PDF (it may be scanned images)', { ms: 4200 });
    }

    /** onPages + onText: build the text out of the already-open document. */
    function gatherText(handle) {
      var total = handle.numPages || 0;
      var blocks = [];
      var chain = Promise.resolve();
      var step = function (n) {
        return function () {
          // PdfText.open has no signal of its own, so Cancel is checked here.
          if (signal && signal.cancelled) {
            var err = new Error('Cancelled');
            err.name = 'AbortError';
            throw err;
          }
          setBusy('Reading page ' + n + ' of ' + total + '…', total ? n / total : 0);
          return handle.textOf(n).then(function (txt) {
            blocks.push('=== PAGE ' + n + ' ===\n' + txt);
          });
        };
      };
      for (var n = 1; n <= total; n++) chain = chain.then(step(n));
      return chain.then(function () {
        signal = null;
        setBusy('', 0);
        var text = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
        var res = { text: text, pages: total, chars: text.length, columnsDetected: 0 };
        showResult(res);
        try { opts.onText(res); } catch (e) { fail(e); }
      }, fail);
    }

    function readPdf(file, readOpts) {
      readOpts = readOpts || {};
      signal = { cancelled: false };
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
          else signal = null;
        }, function (err) { signal = null; fail(err); });
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
    /** Call from the sheet's onClose so the document-level guard goes too. */
    wrap.destroy = function () {
      if (!docGuard) return;
      document.removeEventListener('dragover', docGuard);
      document.removeEventListener('drop', docGuard);
      docGuard = null;
    };
    return wrap;
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

    var node = el('div', 'imp-picker');

    var chips = el('div', 'imp-chips');
    chips.hidden = true;
    node.appendChild(chips);

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

    function buildRows() {
      var secs = Store.splitSections(text);
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
          placement: sec.placement || '',
          rows: info.rows,
          computedOnly: info.computedOnly,
          hasTargets: info.hasTargets,
          target: info.target
        };
      });
      dialect = null;
      if (window.Patterns && typeof window.Patterns.dialectHints === 'function') {
        try { dialect = window.Patterns.dialectHints(text); } catch (e) { dialect = null; }
      }
    }

    function renderChips() {
      clear(chips);
      var any = false;
      if (dialect && dialect.uk && !dialect.us) {
        chips.appendChild(el('span', 'imp-chip', 'Looks like UK terms'));
        any = true;
      }
      chips.hidden = !any;
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
        list.appendChild(el('p', 'muted', IMPORT_EMPTY));
        return;
      }
      listField.hidden = false;
      // Only worth offering when at least one section would get a target.
      targetsRow.hidden = !rows.some(function (r) { return r.rows > 0 && r.target; });
      rows.forEach(function (r, i) {
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
        if (r.makeCount > 1) meta.push('×' + r.makeCount);
        meta.push(r.rows ? r.rows + ' ' + word() + (r.rows === 1 ? '' : 's') : 'no rows');
        // 01 #1: say the target out loud so it is visible and correctable.
        if (r.rows && r.target && !noTargets) meta.push('→ target ' + r.target);
        if (r.rows && r.computedOnly) meta.push('counts computed ≈');
        else if (r.rows && r.hasTargets) meta.push('counts found');
        // The parser found assembly prose for this piece - it lands in the
        // part's Placing button, not in its rounds.
        if (r.placement) meta.push('placing notes');
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
        found = Store.suggestChecklist(text) || [];
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
      buildChecks();
      renderChecks();
      changed();
    }

    function checkedSections() {
      var out = [];
      rows.forEach(function (r) {
        if (r.checked) {
          out.push({
            name: (r.name || '').trim(),
            makeCount: r.makeCount,
            text: r.text,
            placement: r.placement || ''
          });
        }
      });
      return out;
    }

    refresh();

    return {
      node: node,
      setText: function (t) {
        text = typeof t === 'string' ? t : '';
        refresh();
      },
      getText: function () { return text; },
      /** Redraw the section list (the row word may have changed under it). */
      rerender: renderList,
      /** `opts.noTargets` for Store.importPatternSections. */
      noTargets: function () { return noTargets; },
      checkedSections: checkedSections,
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

    function refresh() {
      if (picker) picker.setText(area.value);
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
          announce('Read ' + plural(res.pages, 'page') + ' from the PDF');
        }
      });
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
          tourChecklist: 'import-checklist'
        });
        body.appendChild(picker.node);

        on(area, 'input', debounce(refresh, 200));
        refresh();
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
            Store.importPatternSections(
              p.id,
              [{ name: activeName, makeCount: 1, text: area.value }],
              { mode: 'active', text: area.value, noTargets: picker.noTargets() }
            );
            var extra = addChecklistItems(p.id, picker.checkedChecklist());
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
            var secs = picker.checkedSections();
            if (!secs.length) {
              toast('Tick at least one section first');
              return;
            }
            var res = Store.importPatternSections(p.id, secs, {
              mode: 'parts', text: area.value, noTargets: picker.noTargets()
            });
            var extra = addChecklistItems(p.id, picker.checkedChecklist());
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
            toast(msg + placingSuffix(res.placed) + checklistSuffix(extra), { ms: 3600 });
          }
        }
      ]
    });
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

        function refresh() {
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
    items.push({ icon: '📤', label: 'Download backup', run: function () { exportBackup(); } });
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
      { icon: '📤', label: 'Download backup', run: function () { exportBackup(); } },
      { icon: '❓', label: 'Show me around', run: function () { startTour('counter'); } }
    ];
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

  function backupFilename() {
    var d = new Date();
    return 'thready-or-not-backup-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.json';
  }

  function backupBlob() {
    Store.flush();
    return new Blob([Store.exportJSON()], { type: 'application/json' });
  }

  function exportBackup() {
    var text;
    try {
      Store.flush();
      text = Store.exportJSON();
    } catch (e) {
      toast('Could not create the backup file');
      return;
    }
    if (!downloadText(text, backupFilename(), 'application/json')) {
      toast('Could not create the backup file');
      return;
    }
    toast('Backup downloaded');
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

  /* ---- import: preview first, then choose (09 #3, 12 #3) ---- */

  var BACKUP_MAX_BYTES = 25 * 1024 * 1024;

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

  function countsLine(counts) {
    var bits = [];
    bits.push(counts['new'] + ' new');
    bits.push(counts.replace + ' will be replaced');
    bits.push(counts.identical + ' identical');
    bits.push(counts.older + ' older');
    return bits.join(' · ');
  }

  function importRow(row, choices, label) {
    var item = el('div', 'imp-row');
    var main = el('div', 'imp-row-main');
    main.appendChild(el('div', 'imp-row-name', row.name || '(unnamed)'));
    var meta = [];
    if (label) meta.push(label);
    if (row.craft) meta.push(row.craft);
    meta.push('in the file: ' + fmtBackupDate(row.updatedAt));
    meta.push('on this phone: ' + (row.localUpdatedAt ? fmtBackupDate(row.localUpdatedAt) : 'not here yet'));
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

  function openImportPreviewSheet(text, preview) {
    var choices = { projects: Object.create(null), templates: Object.create(null) };
    preview.projects.forEach(function (r) { choices.projects[r.id] = defaultChoice(r); });
    preview.templates.forEach(function (r) { choices.templates[r.id] = defaultChoice(r); });

    openSheet({
      title: 'Import this backup?',
      cls: 'sheet-import-preview',
      build: function (body) {
        body.appendChild(el('p', 'imp-counts', countsLine(preview.counts)));

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

        body.appendChild(
          el('p', 'muted', 'Keep both copies have no page images — those stay with the project that owns them.')
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
            toast('Imported ' + plural(n, 'project'), {
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
                  }
                : null
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
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    on(input, 'change', function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      // A wrong file (a video, a disk image) would otherwise hang the main
      // thread inside readAsText.
      if (file.size > BACKUP_MAX_BYTES) {
        toast('That file is ' + mb(file.size) + ' — a backup is never that big', { ms: 4200 });
        return;
      }
      guardQuota(file, 'that backup').then(function (ok) {
        if (!ok) return;
        var reader = new FileReader();
        reader.onload = function () {
          var text = String(reader.result);
          var preview;
          try {
            preview = Store.previewImport(text);
          } catch (err) {
            toast(importErrorText(err), { ms: 5200 });
            return;
          }
          openImportPreviewSheet(text, preview);
        };
        reader.onerror = function () {
          toast('Could not read that file');
        };
        reader.readAsText(file);
      });
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
        backup.appendChild(el('div', 'field-hint', 'Importing a backup adds anything new and replaces a project you already have with the copy in the file.'));
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
