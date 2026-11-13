/* Thready or Not — js/app-sewing.js
 * Sewing UI. Registers itself with App.registerCraft({ id: 'sewing', … }) at
 * script-evaluation time; see docs/CRAFTS.md for the contract and
 * docs/research/sewing.md §B.4 for the screens.
 *
 * Everything this file knows about parsing lives in js/sewing.js (window.Sewing);
 * everything it knows about state lives behind Store.updateCraftData, so undo,
 * autosave, export and the timer all keep working for free.
 *
 * Sections:
 *   1. helpers and state access
 *   2. the project screen (#screen-craft)
 *   3. the "Step done ✓" gesture and the quilt unit counter
 *   4. sheets: steps, cutting, notions, size, fabric, machine
 *   4b. page images: the page viewer and the pages sheet
 *   4c. the 2D cutting-table illustration (research §B.4.6)
 *   5. the import sheet
 *   6. new-project fields, menu, FAQ, tour, registration
 */
(function () {
  'use strict';

  if (!window.App || typeof window.App.registerCraft !== 'function') return;
  if (!window.Sewing || !window.Store) return;

  var S = window.Sewing;
  var Store = window.Store;

  /* ================================================================== *
   * 1. Helpers and state access
   * ================================================================== */

  var C = null;              // the shell's ctx, captured on first use
  var view = null;           // the cached project-screen DOM
  var viewProjectId = null;
  var unitTimers = [];

  function dataOf(p) {
    return S.normalize(p && p.craftData, p);
  }

  /**
   * The one door this module writes project state through. `what` names the
   * change for SewingApp.onChange; opts.undo === false writes outside the undo
   * stack (view state, figures found after an import). After the write the
   * pattern milestones (P19) that this change reached are celebrated once.
   */
  function edit(projectId, fn, what, opts) {
    var before = null;
    if (S.milestones && !(opts && opts.quiet)) {
      var p0 = Store.project(projectId);
      if (p0) before = dataOf(p0);
    }
    var res = Store.updateCraftData(projectId, function (raw, proj) {
      var d = S.normalize(raw, proj);
      fn(d, proj);
      return d;
    }, opts && opts.undo === false ? { undo: false } : undefined);
    if (before && res !== null) {
      var p1 = Store.project(projectId);
      var ms = [];
      try { ms = p1 ? S.milestones(before, dataOf(p1)) : []; } catch (e) { ms = []; }
      if (ms.length) sayMilestones(ms);
    }
    emitChange(projectId, what || 'edit');
    return res;
  }

  /* ---- SewingApp.onChange listeners ---- */
  var changeListeners = [];
  function emitChange(projectId, what) {
    changeListeners.slice().forEach(function (fn) {
      try { fn({ projectId: projectId, what: what }); } catch (e) { /* a listener never breaks a write */ }
    });
  }

  /* ---- P19: sewing milestones ---- */
  var MILESTONE_TEXT = {
    'all-cut': 'Everything is cut ✂️',
    'all-fused': 'All the interfacing is fused',
    'top-finished': 'The quilt top is finished',
    'binding-on': 'The binding is on',
    hemmed: 'Hemmed'
  };
  function milestoneLabels(list) {
    return (list || []).map(function (k) { return MILESTONE_TEXT[k] || k; });
  }
  function sayMilestones(list) {
    var labels = milestoneLabels(list);
    if (!labels.length || !C) return;
    try { C.celebrate('piece'); } catch (e) { /* ignore */ }
    C.toast(labels.join(' · '), { ms: 3600 });
    C.announce(labels.join('. '));
  }

  /* ---- the step's own figure (P1 / S4), kept in step.fig (sew-core normalize) ----
   * { kind:'crop', page, blobKey:'p:<id>:fig:…' }   a clean crop (SewFigures mode 'figure')
   * { kind:'page', page, rect:{x0,y0,x1,y1} }       no clean figure: the page, this frame outlined
   * Projects captured before step.fig existed keep the old step.imageRef strings
   * ('p:<id>:fig:…' / 'rect:<page>:x0,y0,x1,y1'), which are still read.        */
  function figureRef(step) {
    if (!step) return null;
    var fg = step.fig;
    if (fg && typeof fg === 'object') {
      if (fg.kind === 'crop' && typeof fg.blobKey === 'string' && /^p:[^:]+:fig:/.test(fg.blobKey)) {
        return { kind: 'crop', blobKey: fg.blobKey, page: typeof fg.page === 'number' ? fg.page : null };
      }
      if (fg.kind === 'page' && typeof fg.page === 'number' && fg.rect && fg.rect.x1 > fg.rect.x0 && fg.rect.y1 > fg.rect.y0) {
        return { kind: 'page', page: fg.page, rect: { x0: fg.rect.x0, y0: fg.rect.y0, x1: fg.rect.x1, y1: fg.rect.y1 } };
      }
    }
    var r = step.imageRef;
    if (typeof r !== 'string' || !r) return null;
    if (/^p:[^:]+:fig:/.test(r)) return { kind: 'crop', blobKey: r };
    var m = /^rect:(\d{1,4}):([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/.exec(r);
    if (m) {
      var rect = { x0: +m[2], y0: +m[3], x1: +m[4], y1: +m[5] };
      if (rect.x1 > rect.x0 && rect.y1 > rect.y0 && rect.x1 <= 1.001 && rect.y1 <= 1.001) {
        return { kind: 'page', page: +m[1], rect: rect };
      }
    }
    return null;
  }
  function rectRef(page, r) {
    function f(x) { return String(Math.round(Math.max(0, Math.min(1, x)) * 1000) / 1000); }
    return 'rect:' + page + ':' + f(r.x0) + ',' + f(r.y0) + ',' + f(r.x1) + ',' + f(r.y1);
  }

  /** Object URLs of figure crops, by blob key; revoked when the screen goes. */
  var figUrls = {};
  function figUrl(blobKey) {
    if (figUrls[blobKey]) return Promise.resolve(figUrls[blobKey]);
    if (!blobsAvailable()) return Promise.resolve(null);
    return window.BlobStore.get(blobKey).then(function (blob) {
      if (!blob) return null;
      if (!figUrls[blobKey]) figUrls[blobKey] = URL.createObjectURL(blob);
      return figUrls[blobKey];
    }, function () { return null; });
  }
  function dropFigUrls() {
    Object.keys(figUrls).forEach(function (k) {
      try { URL.revokeObjectURL(figUrls[k]); } catch (e) { /* ignore */ }
    });
    figUrls = {};
  }

  /* ---- units: the pattern's own, with a per-project switch ---- */
  function profileUnit() {
    try {
      var pr = typeof Store.profile === 'function' ? Store.profile() : null;
      if (pr && pr.units && pr.units.length === 'in') return 'imperial';
    } catch (e) { /* ignore */ }
    return 'metric';
  }
  function chartOf(d) {
    if (!S.readSizeChart) return null;
    try { return S.readSizeChart(d); } catch (e) { return null; }
  }
  /** 'metric' | 'imperial': the project's switch, else the pattern's own units, else the profile. */
  function unitsOf(d, chart) {
    if (d.fabricPrefs && (d.fabricPrefs.unit === 'metric' || d.fabricPrefs.unit === 'imperial')) return d.fabricPrefs.unit;
    var c = chart === undefined ? chartOf(d) : chart;
    if (c && c.units === 'in') return 'imperial';
    if (c && c.units === 'cm') return 'metric';
    if (d.seamAllowance && typeof d.seamAllowance.mm === 'number') {
      if (d.seamAllowance.inches && !/cm|mm/i.test(d.seamAllowance.text || '')) return 'imperial';
      if (/cm|mm/i.test(d.seamAllowance.text || '')) return 'metric';
    }
    return profileUnit();
  }
  function lenUnit(units) { return units === 'imperial' ? 'in' : 'cm'; }

  /* ---- my measurements: the shared profile (shell-data §3) ---- */
  var MEAS_KEYS = {
    bust: 'bust', chest: 'bust', 'full bust': 'bust', waist: 'waist', hip: 'hip', hips: 'hip',
    'full hip': 'hip', 'high hip': 'highHip', height: 'height', inseam: 'inseam', 'in-seam': 'inseam',
    sleeve: 'sleeve', 'sleeve length': 'sleeve', 'back-waist length': 'backWaist',
    'back waist length': 'backWaist', 'back waist': 'backWaist', 'skirt length': 'skirtLength',
    'under bust': 'underBust', underbust: 'underBust', neck: 'neck', shoulder: 'shoulder',
    thigh: 'thigh', 'upper arm': 'upperArm', torso: 'torso'
  };
  function measKey(label) {
    var l = String(label || '').toLowerCase().replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
    if (MEAS_KEYS[l]) return MEAS_KEYS[l];
    var w = l.replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '').split(' ');
    var k = w.map(function (x, i) { return i && x ? x.charAt(0).toUpperCase() + x.slice(1) : x; }).join('');
    return k.slice(0, 40) || 'm';
  }
  function hasProfile() {
    return typeof Store.profile === 'function' && typeof Store.setMeasurement === 'function' &&
      typeof Store.measurement === 'function';
  }
  /** My measurement for a chart label, in `unit` ('cm' | 'in'), or null. */
  function myMeasure(label, unit) {
    if (hasProfile()) {
      var v = null;
      try { v = Store.measurement(measKey(label), unit); } catch (e) { v = null; }
      if (typeof v === 'number' && isFinite(v)) return Math.round(v * 10) / 10;
    }
    // Before wave K the sewing settings bag held free text ('96 cm').
    var bag = settings().measurements;
    if (bag && typeof bag === 'object' && bag[label] && S.measure) {
      var m = S.measure(String(bag[label]), unit);
      if (m && typeof m.mm === 'number') return Math.round((unit === 'in' ? m.mm / 25.4 : m.mm / 10) * 10) / 10;
    }
    return null;
  }
  function setMyMeasure(label, value, unit) {
    var num = parseFloat(String(value).replace(',', '.'));
    if (hasProfile()) {
      try { Store.setMeasurement(measKey(label), isFinite(num) ? num : null, unit); } catch (e) { /* ignore */ }
    } else {
      var bag = settings().measurements;
      if (!bag || typeof bag !== 'object') bag = {};
      bag[label] = isFinite(num) ? num + ' ' + unit : '';
      setSetting('measurements', bag);
    }
  }
  /** The labels to ask for: the chart's body rows, then the usual three. */
  function measureLabels(d, chart) {
    var out = [], seen = {};
    function add(l) { var k = measKey(l); if (!seen[k]) { seen[k] = 1; out.push(l); } }
    if (chart) chart.rows.forEach(function (r) { if (r.kind === 'body') add(r.label); });
    (d.measurements.body || []).forEach(function (r) { add(r.label); });
    ['Bust', 'Waist', 'Hip'].forEach(add);
    return out;
  }
  function mineList(d, chart, unit) {
    var out = [];
    measureLabels(d, chart).forEach(function (l) {
      var v = myMeasure(l, unit);
      if (v !== null) out.push({ label: l, value: String(v), unit: unit });
    });
    return out;
  }
  function adviceFor(d, chart, units) {
    if (!S.suggestSize || !chart) return null;
    var unit = lenUnit(units);
    var mine = mineList(d, chart, unit);
    if (!mine.length) return null;
    try { return S.suggestSize(chart, mine, { unit: unit, rule: S.sizeRule ? S.sizeRule(d.sourceText || '') : null }); } catch (e) { return null; }
  }

  /* ---- everything per size, for the chosen size (P3) ---- */
  var resolvedCache = { key: '', value: null };
  function resolvedFor(p, d) {
    if (!d.size.chosen || !S.resolveSize) return null;
    var k = p.id + '|' + d.size.chosen + '|' + d.steps.length + '|' + (d.sourceText || '').length + '|' +
      d.notions.length + '|' + d.fabric.length + '|' + (p.updatedAt || '');
    if (resolvedCache.key === k) return resolvedCache.value;
    var r = null;
    try { r = S.resolveSize(d, d.size.chosen); } catch (e) { r = null; }
    resolvedCache = { key: k, value: r };
    return r;
  }
  /**
   * '…up the hem by 56 cm': the words before a per-size run are a piece of a sentence,
   * so they are shown as one (sew-audit: "up the hem by 56 cm" read as an instruction).
   */
  function sizeItemText(it, n) {
    var w = String(it.what || '').replace(/…$/, '').replace(/^\s+|\s+$/g, '');
    var head = clip(w, n);
    if (/^[a-z]/.test(head)) head = '…' + head;
    return (head ? head + ' ' : '') + it.value;
  }

  /** The resolved per-size numbers that live in the printed step `n`. */
  function stepSizeItems(res, step) {
    if (!res || !step) return [];
    return res.items.filter(function (it) { return it.where === 'step' && it.step === step.n && step.n; });
  }

  /* ---- extras (js/app-sewing-extras.js), feature-detected ---- */
  function extrasItems(p) {
    var X = window.SewingExtras;
    if (!X || typeof X.menuItems !== 'function' || !p) return [];
    try {
      var list = X.menuItems(p);
      return Array.isArray(list) ? list.filter(function (it) { return it && it.id && it.label; }) : [];
    } catch (e) { return []; }
  }
  /** The extras item whose id or label matches `re`, or null. */
  function extrasFind(p, re) {
    var list = extrasItems(p);
    for (var i = 0; i < list.length; i++) if (re.test(list[i].id) || re.test(list[i].label)) return list[i];
    return null;
  }
  function extrasOpen(id, p, opts) {
    var X = window.SewingExtras;
    if (!X || typeof X.open !== 'function') return false;
    try { return X.open(id, p, opts || {}) !== false; } catch (e) { return false; }
  }
  function recordCount(projectId, n, unit, part, total) {
    if (typeof Store.counted !== 'function' || !n) return;
    try {
      var ev = { projectId: projectId, n: n, unit: unit };
      if (part) ev.part = part;
      if (typeof total === 'number') ev.total = total;
      Store.counted(ev);
    } catch (e) { /* ignore */ }
  }

  function settings() {
    try { return Store.craftSettings('sewing') || {}; } catch (e) { return {}; }
  }
  function setSetting(key, value) {
    try { Store.setCraftSetting('sewing', key, value); } catch (e) { /* ignore */ }
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function newId(prefix) {
    return (prefix || 'sw') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---- page images (research §A.3.4) ---------------------------------- *
   * Opt-in, lazy, capped, and stored in IndexedDB under the shell's
   * `p:<projectId>:` prefix so deleting the project takes them with it.   */

  var MAX_PAGES = (S && S.PAGE_CAP) || 40;
  var KB_PER_PAGE = 250;            // the A.3.4 measurement, used for the estimate

  function pagePrefix(projectId) { return 'p:' + projectId + ':page:'; }

  function blobsAvailable() {
    return !!(window.BlobStore && window.BlobStore.available && window.BlobStore.available());
  }

  /** The stored image row for a 1-based PDF page number, or null. */
  function pageRow(d, n) {
    if (typeof n !== 'number') return null;
    for (var i = 0; i < d.pages.length; i++) if (d.pages[i].n === n) return d.pages[i];
    return null;
  }

  /** '~2 MB' / '~700 kB' for a page count. */
  function sizeEstimate(pages) {
    var kb = pages * KB_PER_PAGE;
    if (kb < 1000) return '~' + Math.round(kb / 50) * 50 + ' kB';
    var mb = kb / 1024;
    return '~' + (mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)) + ' MB';
  }

  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
  }

  var MATERIAL_NAMES = {
    main: 'Main fabric',
    lining: 'Lining',
    interfacing: 'Interfacing',
    contrast: 'Contrast',
    batting: 'Batting',
    other: 'Other'
  };
  var MATERIAL_ORDER = ['main', 'lining', 'interfacing', 'contrast', 'batting', 'other'];

  function cutDone(d) {
    var n = 0;
    for (var i = 0; i < d.cutting.length; i++) if (d.cutting[i].cutCount >= d.cutting[i].qty) n++;
    return n;
  }
  /** '3 of 56 pieces cut': counted in pieces, not rows (05 #3, Wave F). */
  function cutLine(d) {
    var t = S.cutTotals(d);
    return t.cut + ' of ' + plural(t.total, 'piece') + ' cut';
  }
  function notionsDone(d) {
    var n = 0;
    for (var i = 0; i < d.notions.length; i++) if (d.notions[i].have) n++;
    return n;
  }
  /**
   * 'Step 4 of 6, card 2 of 3' in the pattern's own numbering, for
   * announcements. Optional variation / care extras are not counted steps
   * (sewing-audit: the sundress read "Step 1 of 15" for its 8 printed steps).
   */
  function stepWhere(d, index) {
    if (!d.steps.length) return 'No steps';
    var i = Math.max(0, Math.min(index, d.steps.length - 1));
    var pos = S.printedSteps(d.steps).of[i];
    if (!pos) return 'Optional extra';
    return 'Step ' + pos.n + ' of ' + pos.runTotal + (pos.cards > 1 ? ', card ' + pos.card + ' of ' + pos.cards : '');
  }
  function stepsDone(d) {
    var n = 0;
    for (var i = 0; i < d.steps.length; i++) if (d.steps[i].done) n++;
    return n;
  }

  /**
   * 'Seam allowance 1.5 cm (5/8")' for the step card, or ''. Spelled out
   * (HANDOFF small item 0 / UX D8): measured at 375 px it fits one line beside
   * the page chip ('Seam allowance 1 cm (3/8") +1' is 197 px), so the
   * unexplained 'SA' is gone.
   */
  function saLabel(d) {
    var sa = d.seamAllowance;
    if (!sa) return '';
    var text = mmLabel(sa.mm, sa.inches, unitsOf(d, null));
    if (!text) return sa.included === true ? 'Seam allowance included' : '';
    return 'Seam allowance ' + text + (sa.exceptions && sa.exceptions.length ? ' +' + sa.exceptions.length : '');
  }

  /* ================================================================== *
   * 2. The project screen
   * ================================================================== */

  function buildView(main) {
    var el = C.el, button = C.button, on = C.on;
    var v = {};

    // --- progress strip -> Steps sheet -------------------------------------
    v.progress = button('sw-progress', null, 'Open the step list');
    v.progress.setAttribute('data-tour', 'sw-progress');
    var bar = el('div', 'bar');
    v.progressFill = el('div', 'bar-fill');
    bar.appendChild(v.progressFill);
    v.progressLabel = el('div', 'sw-progress-label');
    v.progress.appendChild(bar);
    v.progress.appendChild(v.progressLabel);
    on(v.progress, 'click', function () { openStepsSheet(viewProjectId); });
    main.appendChild(v.progress);

    // --- the 2D cutting table (§B.4.6) --------------------------------------
    v.cutTable = button('sw-cuttable', null, 'Open the cutting list');
    v.cutTable.setAttribute('data-tour', 'sw-cuttable');
    v.cutTable.hidden = true;
    on(v.cutTable, 'click', function () { openCuttingSheet(viewProjectId); });
    main.appendChild(v.cutTable);

    // --- quilt unit counters (B.4.5) ---------------------------------------
    v.units = el('div', 'sw-units');
    main.appendChild(v.units);

    // --- step card ----------------------------------------------------------
    v.card = el('section', 'card sw-step-card');
    v.card.setAttribute('data-tour', 'sw-step-card');
    var head = el('div', 'sw-step-head');
    v.stepN = el('span', 'sw-step-n');
    v.ring = stepRing();
    v.stepSection = el('span', 'sw-step-section');
    head.appendChild(v.stepN);
    head.appendChild(v.ring.node);
    // 'card 2 of 3' when one printed step spans several cards.
    v.cardChip = el('span', 'sw-card-chip');
    v.cardChip.hidden = true;
    head.appendChild(v.cardChip);
    head.appendChild(v.stepSection);
    v.stepText = el('div', 'sw-step-text');
    v.card.appendChild(head);
    v.card.appendChild(v.stepText);
    // A long step is shown to a few lines with this toggle, never as a tiny scroll box
    // (sew-audit: the sundress step 1 showed 148 of its 641 px).
    v.more = button('linkish sw-text-more', 'Show the whole step ▾', 'Show the whole step');
    v.more.hidden = true;
    v.more.setAttribute('aria-expanded', 'false');
    on(v.more, 'click', function () {
      var open = !v.card.classList.contains('sw-text-open');
      v.card.classList.toggle('sw-text-open', open);
      v.more.textContent = open ? 'Show less ▴' : 'Show the whole step ▾';
      v.more.setAttribute('aria-expanded', open ? 'true' : 'false');
      v.more.setAttribute('aria-label', open ? 'Show less of the step' : 'Show the whole step');
    });
    v.card.appendChild(v.more);
    // P3: this step's per-size numbers, for your size only.
    v.yourSize = el('div', 'sw-yoursize');
    v.yourSize.hidden = true;
    v.card.appendChild(v.yourSize);
    // Gap 7: the sewist's own note on this step.
    v.note = button('sw-note', null, 'Your note on this step — tap to edit');
    v.note.hidden = true;
    on(v.note, 'click', function () { openStepNote(viewProjectId, view.at); });
    v.card.appendChild(v.note);
    // P1 / S4: the step's own drawing, cropped from the booklet (never a half crop).
    v.fig = button('sw-fig', null, 'The drawing for this step — tap to see it on the page');
    v.fig.hidden = true;
    v.figImg = document.createElement('img');
    v.figImg.className = 'sw-fig-img';
    v.figImg.alt = '';
    v.figImg.draggable = false;
    v.fig.appendChild(v.figImg);
    on(v.fig, 'click', function () { openStepFigure(viewProjectId, view.at); });
    v.card.appendChild(v.fig);
    // A long card (a whole booklet paragraph) offers the split right here
    // (05 #1, Wave F); the step list holds the same tool for every card.
    v.splitBtn = button('linkish sw-card-split', '✂ Split this card', 'Split this card into two');
    v.splitBtn.hidden = true;
    on(v.splitBtn, 'click', function () {
      var pr = Store.project(viewProjectId);
      if (!pr) return;
      var dd = dataOf(pr);
      openStepsSheet(viewProjectId, { toolsAt: Math.min(dd.currentStep, dd.steps.length - 1) });
    });
    v.card.appendChild(v.splitBtn);
    main.appendChild(v.card);

    // --- step meta ----------------------------------------------------------
    v.meta = el('div', 'sw-step-meta');
    v.page = button('chip sw-page', null, 'Page');
    on(v.page, 'click', function () {
      if (typeof view.pageNo === 'number') openStepFigure(viewProjectId, view.at);
    });
    v.sa = button('sw-sa', null, 'Seam allowance — tap for the details');
    on(v.sa, 'click', function () { openSeamSheet(viewProjectId); });
    v.meta.appendChild(v.page);
    v.meta.appendChild(v.sa);
    // P15: the step's own set-up (its seam allowance, trims, topstitching, foot, press / fuse).
    v.setup = el('span', 'sw-setup');
    v.meta.appendChild(v.setup);
    main.appendChild(v.meta);

    // P10 / S3: the other units this step makes, one line.
    v.unitStrip = el('div', 'sw-unit-strip');
    v.unitStrip.hidden = true;
    main.appendChild(v.unitStrip);

    // --- the big button -----------------------------------------------------
    v.btn = button('stitch-btn sw-step-btn', null, 'Step done');
    v.btn.id = 'sw-step-btn';
    v.btn.setAttribute('data-tour', 'sw-step-btn');
    v.btnCaption = el('span', 'stitch-caption', 'STEP DONE');
    v.btnMark = el('span', 'sw-step-mark', '✓');
    v.btnHint = el('span', 'stitch-hint', 'tap when you have done it');
    v.btn.appendChild(v.btnCaption);
    v.btn.appendChild(v.btnMark);
    v.btn.appendChild(v.btnHint);
    wireStepButton(v.btn);
    main.appendChild(v.btn);

    var under = el('div', 'sw-under');
    // When the big button counts a unit, Step done is a link in the unit strip above the
    // button (paintUnitStrip), so it is never under the fold (sew-audit: Harmony 812–856).
    // P2: the step as the whole screen.
    if (C.workMode && typeof C.workMode.button === 'function' && window.WorkMode) {
      try {
        v.workBtn = C.workMode.button(WORK_LABEL);
        v.workBtn.classList.add('sw-work-open');
        v.workBtn.setAttribute('data-tour', 'sw-work');
        under.appendChild(v.workBtn);
      } catch (e) { v.workBtn = null; }
    }
    main.appendChild(under);

    v.back = button('linkish sw-back', '↺ back a step', 'Undo the last step');
    on(v.back, 'click', function () {
      if (Store.undo()) {
        C.fb('undo');
        C.toast('Undone');
      } else {
        C.toast('Nothing to undo');
      }
      C.render();
    });
    main.appendChild(v.back);

    // --- the mini rows ------------------------------------------------------
    v.mini = el('section', 'card sw-mini');
    v.miniSize = miniRow('📏', 'Size', function () { openSizeSheet(viewProjectId); }, 'sw-mini-size');
    v.miniCut = miniRow('✂️', 'Cutting', function () { openCuttingSheet(viewProjectId); }, 'sw-mini-cut');
    v.miniNotions = miniRow('🧷', 'Notions', function () { openNotionsSheet(viewProjectId); }, 'sw-mini-notions');
    v.mini.appendChild(v.miniSize.node);
    v.mini.appendChild(v.miniCut.node);
    v.mini.appendChild(v.miniNotions.node);
    v.miniSheet = miniRow('🗺️', 'Pattern sheet', function () { openSheetView(viewProjectId); }, 'sw-mini-sheet');
    v.miniSheet.node.hidden = true;
    v.mini.appendChild(v.miniSheet.node);
    main.appendChild(v.mini);

    // --- bottom bar ---------------------------------------------------------
    var bb = el('nav', 'bottombar');
    bb.setAttribute('aria-label', 'Project tools');
    bb.appendChild(barButton('↶', 'Undo', function () {
      if (Store.undo()) { C.fb('undo'); C.toast('Undone'); } else { C.toast('Nothing to undo'); }
      C.render();
    }));
    bb.appendChild(barButton('☰', 'Steps', function () { openStepsSheet(viewProjectId); }));
    // The shell owns the wake lock; a craft bottom bar just flips the setting.
    // Guarded because older shells (and browsers without the Wake Lock API)
    // do not offer it at all.
    if (C.wake && C.wake.supported) {
      v.awake = barButton('☀', 'Awake', function () {
        var on2 = C.wake.toggle();
        v.awake.classList.toggle('on', !!on2);
        v.awake.setAttribute('aria-pressed', on2 ? 'true' : 'false');
        C.fb('tap');
      });
      v.awake.setAttribute('aria-pressed', C.wake.isOn() ? 'true' : 'false');
      v.awake.classList.toggle('on', !!C.wake.isOn());
      bb.appendChild(v.awake);
    }
    bb.appendChild(barButton('✂️', 'Cut', function () { openCuttingSheet(viewProjectId); }));
    bb.appendChild(barButton('🧷', 'Notions', function () { openNotionsSheet(viewProjectId); }));
    main.appendChild(bb);

    return v;
  }

  function miniRow(icon, label, run, tourId) {
    // The class is what the tour and the tests hook onto; data-tour is what the
    // shell's spotlight engine looks for.
    var node = C.button('sw-mini-row' + (tourId ? ' ' + tourId : ''), null, label);
    if (tourId) node.setAttribute('data-tour', tourId);
    var ic = C.el('span', 'sw-mini-icon', icon);
    var text = C.el('span', 'sw-mini-text');
    var go = C.el('span', 'sw-mini-go', '›');
    node.appendChild(ic);
    node.appendChild(text);
    node.appendChild(go);
    C.on(node, 'click', run);
    return { node: node, text: text };
  }

  function barButton(icon, label, run) {
    var b = C.button('bar-btn', null, label);
    b.appendChild(C.el('span', 'bar-icon', icon));
    b.appendChild(C.el('span', null, label));
    C.on(b, 'click', run);
    return b;
  }

  /** Repaint the cached DOM from state. Cheap; called on every App.render(). */
  function paint(p) {
    if (!view || !p) return;
    var d = dataOf(p);
    var total = d.steps.length;
    var at = total ? Math.min(d.currentStep, total - 1) : 0;
    // The pattern's own numbering (coordinator, Wave E): the user reads the
    // paper alongside, so "Step 4 of 6" is the printed step 4 of the pencil
    // skirt's 6, whichever of its cards is showing. The card position is a
    // secondary chip only when a printed step spans several cards.
    var ps = S.printedSteps(d.steps);
    var pos = total ? ps.of[at] : null;
    var done = S.printedDone(d.steps, ps);
    var pct = ps.total ? Math.round((done / ps.total) * 100) : 0;
    var step = total ? d.steps[at] : null;
    var optAt = 0, optAll = 0;
    for (var oi = 0; oi < total; oi++) {
      if (!d.steps[oi].optional) continue;
      optAll++;
      if (oi <= at) optAt = optAll;
    }
    var where = !total ? '' : (pos
      ? 'Step ' + pos.n + ' of ' + pos.runTotal
      : 'Optional extra ' + optAt + ' of ' + optAll);
    view.cardChip.textContent = pos && pos.cards > 1 ? 'card ' + pos.card + ' of ' + pos.cards : '';
    view.cardChip.hidden = !(pos && pos.cards > 1);

    view.progressFill.style.width = pct + '%';
    view.progressLabel.textContent = total
      ? where + ' · ' + pct + '%'
      : 'No steps yet — import or add some';
    view.progress.setAttribute('aria-label',
      total ? where + ', open the step list' : 'Add steps');

    view.stepN.textContent = total ? (step && step.optional ? 'EXTRA' : 'STEP') : 'NO STEPS';
    if (pos) view.ring.set(pos.n, Math.max(pos.n, pos.runTotal));
    else view.ring.set(optAt, optAll);
    view.stepSection.textContent = step && step.section ? step.section : '';
    view.stepText.textContent = step
      ? step.text
      : 'Import the instruction PDF from the ⋯ menu, or add steps in the step list.';
    view.card.classList.toggle('sw-empty', !total);

    // The page chip opens the page image when there is one, and is plain text
    // when there is not (the number still tells you where to look in the PDF).
    view.pageNo = step && typeof step.page === 'number' ? step.page : null;
    if (view.pageNo) {
      var hasImg = !!pageRow(d, view.pageNo);
      view.page.textContent = '📄 page ' + view.pageNo;
      view.page.hidden = false;
      view.page.disabled = !hasImg;
      view.page.classList.toggle('sw-page-plain', !hasImg);
      view.page.setAttribute('aria-label', hasImg
        ? 'Show page ' + view.pageNo + ' of the booklet'
        : 'This step is on page ' + view.pageNo + ' of the booklet');
    } else {
      view.page.hidden = true;
    }
    // The seam-allowance exception, at the point of use (05 #15, Wave F):
    // on a step that mentions the neckline the chip reads the neckline's
    // allowance, in the accent colour. A reminder, never a rule.
    var rem = step ? S.saReminder(d, step.text) : null;
    var saUnits = unitsOf(d, null);
    var sa = rem
      ? 'Seam allowance ' + mmLabel(rem.mm, rem.inches, saUnits) + ' · ' + rem.part
      : saLabel(d);
    view.sa.textContent = sa;
    view.sa.hidden = !sa;
    view.sa.classList.toggle('sw-sa-alt', !!rem);
    view.sa.setAttribute('aria-label', rem
      ? 'This step mentions the ' + rem.part + ' — the pattern sews those at ' + rem.mm + ' mm. Tap for the details'
      : 'Seam allowance — tap for the details');
    view.splitBtn.hidden = !(step && step.text.length > 350 && S.sentences(step.text).length > 1);
    view.at = at;

    // P15: the step's own set-up chips (the SA chip above stays the tap target).
    var setup = setupOf(step, d);
    if (setup && setup.sa && setup.sa.source === 'step') {
      view.sa.textContent = 'Seam allowance ' + mmLabel(setup.sa.mm, setup.sa.inches, saUnits) + ' · this step';
      view.sa.hidden = false;
      view.sa.classList.add('sw-sa-alt');
      view.sa.setAttribute('aria-label', 'This step sews at ' + mmLabel(setup.sa.mm, setup.sa.inches, saUnits) + '. Tap for the pattern’s seam allowances');
    }
    paintSetup(p, d, step, setup);

    // P3: this step's per-size numbers, at your size.
    var sizeItems = stepSizeItems(resolvedFor(p, d), step);
    C.clear(view.yourSize);
    view.yourSize.hidden = !sizeItems.length;
    if (sizeItems.length) {
      view.yourSize.appendChild(C.el('span', 'sw-yoursize-tag', 'Size ' + d.size.chosen));
      sizeItems.slice(0, 4).forEach(function (it) {
        view.yourSize.appendChild(C.el('span', 'chip sw-yoursize-val', sizeItemText(it, 28)));
      });
    }

    // Gap 7: the sewist's note and edit mark.
    view.note.hidden = !(step && step.note);
    if (step && step.note) {
      view.note.textContent = '📝 ' + step.note + (step.noteStale ? ' (the step’s text changed since you wrote this)' : '');
    }
    view.card.classList.toggle('sw-edited', !!(step && step.edited));

    // P1 / S4: the step's own figure.
    paintFigure(d, step);

    // P10 / S3: a unit this step makes takes the big button.
    var au = activeUnitOf(d);
    var stepUnits = unitsInStep(d, at);
    var isDone = ps.total > 0 && done >= ps.total;
    view.btn.disabled = !total;
    view.btn.classList.toggle('sw-unit-btn', !!au);
    if (au) {
      var u = au.unit;
      view.btnCaption.textContent = String(u.name).toUpperCase();
      view.btnMark.textContent = u.done + ' / ' + u.target;
      view.btnHint.textContent = 'tap for each one you make' + (u.size ? ' · ' + u.size : '');
      view.btn.setAttribute('aria-label', 'Count one ' + u.name + ', ' + u.done + ' of ' + u.target + ' made');
    } else {
      view.btnCaption.textContent = isDone ? 'ALL DONE' : 'STEP DONE';
      view.btnMark.textContent = isDone ? '🎉' : '✓';
      view.btnHint.textContent = !total
        ? 'add some steps first'
        : (isDone ? 'every step is ticked off' : 'tap when you have done it');
      view.btn.setAttribute('aria-label', 'Step done');
    }
    paintUnitStrip(p, d, stepUnits, au);
    view.card.classList.toggle('sw-unit-step', !!au);
    // The long-text toggle: reset on a new step, shown only when the text is cut.
    if (view.textAt !== at || view.textKey !== (step ? step.text.length : 0)) {
      view.textAt = at;
      view.textKey = step ? step.text.length : 0;
      view.card.classList.remove('sw-text-open');
      view.more.textContent = 'Show the whole step ▾';
      view.more.setAttribute('aria-expanded', 'false');
      view.more.setAttribute('aria-label', 'Show the whole step');
    }
    if (!view.card.classList.contains('sw-text-open')) {
      view.more.hidden = !(view.stepText.scrollHeight > view.stepText.clientHeight + 2);
    }
    view.card.classList.toggle('sw-text-cut', !view.more.hidden && !view.card.classList.contains('sw-text-open'));
    // On a unit step the step list's ✎ has the split; the screen keeps its room for the button.
    if (au) view.splitBtn.hidden = true;
    view.back.hidden = !total;
    if (view.workBtn) view.workBtn.hidden = !total;

    // mini rows: the chrome follows the kind (P14)
    var voc = vocabOf(d);
    var sizeBits = [];
    if (d.size.chosen) sizeBits.push('Size ' + d.size.chosen);
    if (d.size.alterations) sizeBits.push(clip(d.size.alterations, 40));
    var finished = voc.showFinished && !voc.showSizes ? finishedText(d) : '';
    view.miniSize.node.hidden = !voc.showSizes && !finished;
    view.miniSize.text.textContent = !voc.showSizes
      ? (finished ? 'Finished ' + finished : '')
      : (sizeBits.length ? sizeBits.join(' · ') : 'Pick your size and note alterations');
    view.miniSheet.node.hidden = !d.sheet;
    if (d.sheet) view.miniSheet.text.textContent = sheetLine(d.sheet);
    view.miniCut.text.textContent = d.cutting.length ? cutLine(d) : 'No cutting list yet';
    view.miniNotions.text.textContent = d.notions.length
      ? notionsDone(d) + ' of ' + d.notions.length + ' notions ready'
      : 'No notions list yet';

    if (view.awake && C.wake) {
      var awakeOn = !!C.wake.isOn();
      view.awake.classList.toggle('on', awakeOn);
      view.awake.setAttribute('aria-pressed', awakeOn ? 'true' : 'false');
    }

    paintCutTable(d);
    // P10: on a step that makes units the button must stay above the fold; the cutting
    // table is one tap away (✂ in the bottom bar and the Cutting row).
    // sew-audit: the strip of truncated labels ("Main… Main…") only on a cutting step, where it
    // is a progress bar for the cutting; everywhere else the step keeps the room.
    if (au || !isCutStep(step)) view.cutTable.hidden = true;
    paintUnits(p, d);
  }

  function paintUnits(p, d) {
    var wrap = view.units;
    // Wave K (P10): units that know their step live in that step (the big
    // button and the strip); the old card stack is only for units that do not.
    if (unitsHaveSteps(d)) {
      if (wrap.childNodes.length) { clearUnitTimers(); C.clear(wrap); wrap.__sig = ''; }
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    // The counters change rarely, so a full rebuild here is cheap and safe.
    if (wrap.childNodes.length === d.units.length && wrap.__sig === unitSig(d)) {
      return;
    }
    clearUnitTimers();
    C.clear(wrap);
    wrap.__sig = unitSig(d);
    for (var i = 0; i < d.units.length; i++) wrap.appendChild(unitCard(p, d.units[i]));
  }

  function unitSig(d) {
    var out = [];
    for (var i = 0; i < d.units.length; i++) {
      out.push(d.units[i].id + ':' + d.units[i].name + ':' + d.units[i].done + '/' + d.units[i].target);
    }
    return out.join('|');
  }

  function clearUnitTimers() {
    while (unitTimers.length) window.clearTimeout(unitTimers.pop());
  }

  /** B.4.5 — the quilt block counter: tap to +1, long-press for −1. */
  function unitCard(p, unit) {
    var el = C.el;
    var card = C.button('card sw-unit', null, unit.name + ', ' + unit.done + ' of ' + unit.target);
    card.appendChild(el('div', 'sw-unit-name', unit.name.toUpperCase()));
    card.appendChild(el('div', 'sw-unit-count', unit.done + ' / ' + unit.target));
    var bar = el('div', 'bar');
    var fill = el('div', 'bar-fill');
    var pct = unit.target > 0 ? Math.min(100, Math.round((unit.done / unit.target) * 100)) : 0;
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    card.appendChild(bar);
    card.appendChild(el('div', 'sw-unit-pct', pct + '%'));

    var held = false, timer = null, sx = 0, sy = 0, moved = false;

    function bump(delta) { bumpUnit(p.id, unit.id, delta); }

    C.on(card, 'pointerdown', function (e) {
      held = false; moved = false;
      sx = e.clientX; sy = e.clientY;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () { held = true; bump(-1); }, 500);
      unitTimers.push(timer);
    });
    C.on(card, 'pointermove', function (e) {
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (dx * dx + dy * dy > 144) { moved = true; if (timer) window.clearTimeout(timer); }
    });
    C.on(card, 'pointerup', function () {
      if (timer) window.clearTimeout(timer);
      if (!held && !moved) bump(1);
      held = false;
    });
    C.on(card, 'pointercancel', function () { if (timer) window.clearTimeout(timer); held = false; });
    C.on(card, 'click', function (e) { if (e.detail === 0) bump(1); });   // keyboard
    // The long press is the only way back a block, and a keyboard cannot long
    // press — crochet and cross-stitch both give their −1 a real control.
    C.on(card, 'keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== '-' && e.key !== 'Backspace') return;
      e.preventDefault();
      bump(-1);
    });
    return card;
  }

  /* ================================================================== *
   * 2b. Wave K on the step screen: set-up chips (P15), the figure (P1),
   *     units in their step (P10), kind-aware chrome (P14)
   * ================================================================== */

  var WORK_LABEL = 'Sewing mode';

  function refreshWork() {
    if (C && C.workMode && typeof C.workMode.refresh === 'function') {
      try { C.workMode.refresh(); } catch (e) { /* ignore */ }
    }
  }

  function vocabOf(d) {
    var base = { unit: 'step', units: 'steps', piece: 'piece', pieces: 'pieces', sizeWord: 'Size', showSizes: true, showFinished: false, kindWord: 'project' };
    if (!S.vocab) return base;
    try { return S.vocab(d.kind || 'unknown') || base; } catch (e) { return base; }
  }

  var factsCache = { key: '', value: null };
  /** '70" × 80"' for a quilt or bag whose finished size the pattern prints, else ''. */
  function finishedText(d) {
    if (!S.quiltFacts) return '';
    var k = (d.sourceText || '').length + '|' + d.kind + '|' + d.steps.length;
    if (factsCache.key !== k) {
      var f = null;
      try { f = S.quiltFacts(d); } catch (e) { f = null; }
      factsCache = { key: k, value: f };
    }
    var fin = factsCache.value && factsCache.value.finished;
    return fin && fin.text ? fin.text : '';
  }

  function sheetLine(sh) {
    var bits = [];
    if (sh.pieces && sh.pieces.length) bits.push(plural(sh.pieces.length, 'piece'));
    if (sh.tiles && sh.tiles.tiles) {
      var n = sh.tiles.tiles.length, t = 0;
      sh.tiles.tiles.forEach(function (x) { if (sh.taped && sh.taped[x.label]) t++; });
      bits.push(t + ' of ' + n + ' sheets taped');
    }
    if (sh.paper && sh.paper !== 'A4/Letter') bits.push(sh.paper);
    return bits.length ? bits.join(' · ') : 'Pattern sheet';
  }

  /**
   * '1 cm (3/8")' for a metric pattern, '1/2" (1.3 cm)' for an inch one: the pattern's own
   * unit first (BUILD.md). `units` defaults to inches first when the pattern printed inches.
   */
  function mmLabel(mm, inches, units) {
    if (typeof mm !== 'number') return inches ? inches + '"' : '';
    var metric = mm >= 10 ? (Math.round(mm) / 10) + ' cm' : Math.round(mm) + ' mm';
    if (!inches) return metric;
    if (units === 'metric') return metric + ' (' + inches + '")';
    return inches + '" (' + metric + ')';
  }

  var setupCache = { key: '', value: null };
  function setupOf(step, d) {
    if (!step || !S.stepSetup) return null;
    var k = step.id + '|' + step.text.length + '|' + step.text.slice(0, 40) + '|' + (d.seamAllowance ? d.seamAllowance.mm : '');
    if (setupCache.key === k) return setupCache.value;
    var v = null;
    try { v = S.stepSetup(step.text, d); } catch (e) { v = null; }
    setupCache = { key: k, value: v };
    return v;
  }

  /** Is this a cutting step (for the cutting-board deep link)? */
  function isCutStep(step) {
    return !!(step && (/^\s*(?:\(continued\)\s*)?cut\b/i.test(step.text) || /\bcutting\b/i.test(step.section || '')));
  }

  /** The chips under the step (P15), plus the extras deep links (cutting board, press timer). */
  function paintSetup(p, d, step, setup) {
    var box = view.setup;
    C.clear(box);
    if (!step) return;
    var chips = setup && setup.chips ? setup.chips.filter(function (c) { return c.kind !== 'sa'; }) : [];
    chips.forEach(function (c) {
      var timer = (c.kind === 'press' || c.kind === 'fuse') ? extrasFind(p, /timer|press|fuse/i) : null;
      var label = c.kind === 'foot' ? '🦶 ' + c.label : ((c.kind === 'press' || c.kind === 'fuse') ? '⏱ ' + c.label : c.label);
      var node;
      if (timer) {
        node = C.button('chip sw-setup-chip sw-setup-' + c.kind, label, c.label + ': open the timer');
        C.on(node, 'click', function () {
          extrasOpen(timer.id, Store.project(p.id) || p, { from: 'step', step: view.at, kind: c.kind });
        });
      } else {
        node = C.el('span', 'chip sw-setup-chip sw-setup-' + c.kind, label);
        if (c.kind === 'foot' && setup.footWhy && setup.footWhy !== 'the step names it') node.title = 'A suggestion: ' + setup.footWhy;
      }
      box.appendChild(node);
    });
    if (isCutStep(step)) {
      var board = extrasFind(p, /cut/i);
      var cut = C.button('chip sw-setup-chip sw-setup-cut', '✂ ' + (board ? board.label : 'Cutting list'),
        'Open the ' + (board ? board.label.toLowerCase() : 'cutting list'));
      C.on(cut, 'click', function () {
        var pr = Store.project(p.id) || p;
        if (!(board && extrasOpen(board.id, pr, { from: 'step', step: view.at }))) openCuttingSheet(p.id);
      });
      box.appendChild(cut);
    }
    box.hidden = !box.childNodes.length;
  }

  var figToken = 0;
  /** The figure under the step text: a clean crop, never a half one. */
  function paintFigure(d, step) {
    var ref = figureRef(step);
    var v = view;
    if (!ref || ref.kind !== 'crop') {
      ++figToken;
      v.fig.hidden = true;
      v.fig.__key = '';
      v.card.classList.remove('sw-has-fig');
      return;
    }
    if (v.fig.__key === ref.blobKey && !v.fig.hidden) return;
    var token = ++figToken;
    v.fig.__key = ref.blobKey;
    figUrl(ref.blobKey).then(function (url) {
      if (token !== figToken || view !== v) return;
      if (!url) { v.fig.hidden = true; v.card.classList.remove('sw-has-fig'); return; }
      v.figImg.src = url;
      v.figImg.alt = 'The drawing for this step, from the booklet';
      v.fig.hidden = false;
      v.card.classList.add('sw-has-fig');
    });
  }

  /** Tap the figure (or the page chip): the page with this step framed, else the drawing large. */
  function openStepFigure(projectId, index) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    var st = d.steps[index];
    if (!st) return;
    var ref = figureRef(st);
    var pageNo = typeof st.page === 'number' ? st.page : (ref && ref.page) || null;
    if (pageNo && pageRow(d, pageNo)) {
      openPageViewer(projectId, pageNo, ref && ref.kind === 'page' && ref.page === pageNo ? ref.rect : null);
      return;
    }
    if (ref && ref.kind === 'crop' && C.pageViewer && window.PageViewer) {
      C.pageViewer({ title: 'Step drawing', pages: [{ label: 'The drawing for this step', blobKey: ref.blobKey }], index: 0 });
    }
  }

  /** Gap 7: the sewist's note on a step, kept across a re-import (sew-core). */
  function openStepNote(projectId, index) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    var st = d.steps[index];
    if (!st) return;
    var area = C.textArea(st.note || '', 'sw-note-area', 'Used a 2.5 stitch here; pressed towards the back…');
    area.setAttribute('aria-label', 'Your note on this step');
    var footer = [
      { text: 'Cancel', cls: 'btn ghost', onClick: function (a) { a.close(); } },
      { text: 'Save', cls: 'btn primary', onClick: function (a) {
        var text = area.value.replace(/^\s+|\s+$/g, '');
        edit(projectId, function (dd) {
          if (S.setStepNote) S.setStepNote(dd, index, text);
          else if (dd.steps[index]) dd.steps[index].note = text;
        }, 'note');
        a.close();
        paint(Store.project(projectId));
        refreshWork();
        C.toast(text ? 'Note saved' : 'Note removed');
      } }
    ];
    if (st.note) {
      footer.splice(1, 0, { text: 'Remove', cls: 'btn danger', onClick: function (a) {
        edit(projectId, function (dd) { if (S.setStepNote) S.setStepNote(dd, index, ''); else if (dd.steps[index]) delete dd.steps[index].note; }, 'note');
        a.close();
        paint(Store.project(projectId));
        refreshWork();
        C.toast('Note removed');
      } });
    }
    C.openSheet({
      title: 'Note · ' + stepWhere(d, index),
      cls: 'sheet-sewing',
      build: function (b) {
        b.appendChild(C.field('Your note', area, 'Kept with this step, even if you import the pattern again.'));
        if (st.noteStale) b.appendChild(C.el('p', 'field-hint', 'The step’s text changed since you wrote this note.'));
        window.setTimeout(function () { try { area.focus(); } catch (e) { /* ignore */ } }, 60);
      },
      footer: footer
    });
  }

  /** Gap 7: correct the step's text (the printed text stays the key, so a re-import keeps it). */
  function openStepEdit(projectId, index, after) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    var st = d.steps[index];
    if (!st) return;
    var area = C.textArea(st.text, 'sw-edit-area', '');
    area.setAttribute('aria-label', 'The step’s text');
    C.openSheet({
      title: 'Edit · ' + stepWhere(d, index),
      cls: 'sheet-sewing',
      build: function (b) {
        b.appendChild(C.field('Step', area, 'Your wording is kept when you import the same pattern again.'));
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (a) { a.close(); } },
        { text: 'Save', cls: 'btn primary', onClick: function (a) {
          var text = area.value.replace(/^\s+|\s+$/g, '');
          if (!text) { C.toast('A step needs some text'); return; }
          edit(projectId, function (dd) {
            if (S.editStep) S.editStep(dd, index, text);
            else if (dd.steps[index]) dd.steps[index].text = text;
          }, 'edit');
          a.close();
          paint(Store.project(projectId));
          refreshWork();
          if (after) after();
          C.toast('Step saved');
        } }
      ]
    });
  }

  function unitsHaveSteps(d) {
    for (var i = 0; i < d.units.length; i++) if (d.units[i].stepKey || typeof d.units[i].step === 'number') return true;
    return false;
  }
  function activeUnitOf(d) {
    if (!S.activeUnit || !d.units.length || !d.steps.length || !unitsHaveSteps(d)) return null;
    try {
      var a = S.activeUnit(d);
      return a && a.unit && a.unit.target > 0 ? a : null;
    } catch (e) { return null; }
  }
  function unitsInStep(d, at) {
    if (!S.unitsForStep || !d.units.length || !unitsHaveSteps(d)) return [];
    try { return S.unitsForStep(d, at) || []; } catch (e) { return []; }
  }

  /** The step's other units, one line of chips; −1 for the one being counted. */
  function paintUnitStrip(p, d, units, au) {
    var strip = view.unitStrip;
    C.clear(strip);
    strip.hidden = !units.length;
    if (!units.length) return;
    // "Units 1a 1/4 · 1b 0/4 · 1c 0/2": the shared word once, so the strip stays one line
    // (sew-audit: three units wrapped to three rows in Pixel Wyrm and pushed the button down).
    // Only when what is left still reads as a name ("1a", not a bare "1" beside "0/2").
    var allUnit = units.length > 1 && units.every(function (u) { return /^unit\s+\d*[a-z]/i.test(u.name); });
    // The chips scroll sideways in their own row; −1 and Step done stay put at the end,
    // so the strip is one line at 375 px whatever the theme's font.
    var chipsBox = C.el('span', 'sw-unit-chips');
    if (allUnit) chipsBox.appendChild(C.el('span', 'sw-unit-lead', 'Units'));
    strip.appendChild(chipsBox);
    units.forEach(function (u) {
      var isOn = au && au.unit.id === u.id;
      var full = u.target > 0 && u.done >= u.target;
      var shown = allUnit ? u.name.replace(/^unit\s+/i, '') : u.name;
      var chip = C.el('span', 'chip sw-unit-chip' + (isOn ? ' on' : '') + (full ? ' done' : ''),
        shown + ' ' + u.done + '/' + u.target + (full ? ' ✓' : ''));
      chip.setAttribute('aria-label', u.name + ', ' + u.done + ' of ' + u.target + ' made' + (isOn ? ', counting now' : ''));
      chipsBox.appendChild(chip);
    });
    if (au) {
      var minus = C.button('chip sw-unit-minus', '−1', 'Take one off ' + au.unit.name);
      C.on(minus, 'click', function () { bumpUnit(p.id, au.unit.id, -1); });
      strip.appendChild(minus);
      // The big button counts the unit, so Step done is this link, above the button.
      var sd = C.button('linkish sw-step-link', '✓ Step done', 'Mark this step done');
      C.on(sd, 'click', function () { stepDone(p.id); });
      strip.appendChild(sd);
    }
  }

  /** +1 / −1 on a unit counter, recorded as work (Store.counted) and said once (ctx.counted). */
  function bumpUnit(projectId, unitId, delta) {
    var p = Store.project(projectId);
    if (!p) return;
    var reached = false, moved = 0;
    edit(projectId, function (d) {
      for (var i = 0; i < d.units.length; i++) {
        if (d.units[i].id !== unitId) continue;
        var next = d.units[i].done + delta;
        if (next < 0) next = 0;
        if (d.units[i].target > 0 && next > d.units[i].target) next = d.units[i].target;
        reached = delta > 0 && d.units[i].target > 0 && next >= d.units[i].target && d.units[i].done < d.units[i].target;
        moved = next - d.units[i].done;
        d.units[i].done = next;
      }
    }, 'unit');
    var fresh = Store.project(projectId);
    var now = dataOf(fresh);
    var row = null;
    for (var j = 0; j < now.units.length; j++) if (now.units[j].id === unitId) row = now.units[j];
    if (moved && row) recordCount(projectId, moved, 'unit', row.name, row.target);
    if (row) {
      if (C.counted) {
        C.counted({
          n: row.done, total: row.target, unit: 'unit', units: 'made', label: row.name,
          kind: delta < 0 ? 'undo' : (reached ? 'done' : (row.done % 10 === 0 ? 'group' : 'tap')),
          node: view && view.btn,
          say: reached ? row.name + ': all ' + row.target + ' made' : (delta < 0 ? row.name + ' ' + row.done + ' of ' + row.target : undefined)
        });
      } else {
        C.fb(delta < 0 ? 'undo' : 'tap');
        C.announce(row.name + ' ' + row.done + ' of ' + row.target);
      }
    }
    paint(fresh);
    refreshWork();
    if (reached && row) {
      C.celebrate('piece');
      var rest = unitsInStep(now, Math.min(now.currentStep, now.steps.length - 1)).filter(function (u) { return u.target > 0 && u.done < u.target; });
      if (!rest.length && unitsHaveSteps(now)) {
        C.toast(row.name + ' all made ✓ — every unit of this step is done', {
          actionText: 'Step done', ms: 5200,
          onAction: function () { stepDone(projectId); }
        });
      } else {
        C.toast(row.name + ' all made ✓');
      }
    }
  }

  /* ---- P2: the sewing working mode (shell-ui §1, def.workMode) ---- */

  var workSurface = null;

  function workWhere(d, at) {
    var ps = S.printedSteps(d.steps);
    return { ps: ps, pos: ps.of[at] || null };
  }

  var WORK_SPEC = {
    label: WORK_LABEL,
    // css/sewing.css lets the step text run to its end here (the shell clamps a row line to 3).
    cls: 'sw-work',
    // The first tip before the readout paints (the shell's default says "Tap anywhere").
    tip: 'Tap here when the step is done',
    icon: '⤢',
    backTo: 'the step list',
    surface: function (node, api) {
      var wrap = document.createElement('div');
      wrap.className = 'sw-work-fig';
      wrap.setAttribute('aria-hidden', 'true');
      var img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.hidden = true;
      wrap.appendChild(img);
      node.appendChild(wrap);
      var key = '';
      var token = 0;
      function place(ins) {
        ins = ins || (api.insets ? api.insets() : null) || { top: 0, right: 0, bottom: 0, left: 0 };
        wrap.style.top = ins.top + 'px';
        wrap.style.right = ins.right + 'px';
        wrap.style.bottom = ins.bottom + 'px';
        wrap.style.left = ins.left + 'px';
      }
      function update() {
        var p = api.project();
        if (!p) return;
        var d = dataOf(p);
        var st = d.steps[Math.min(d.currentStep, Math.max(0, d.steps.length - 1))];
        var ref = figureRef(st);
        var want = ref && ref.kind === 'crop' ? ref.blobKey : '';
        if (want === key) return;
        key = want;
        var t = ++token;
        if (!want) { img.hidden = true; img.removeAttribute('src'); return; }
        figUrl(want).then(function (url) {
          if (t !== token) return;
          if (!url) { img.hidden = true; return; }
          img.src = url;
          img.hidden = false;
        });
      }
      workSurface = { update: update };
      place();
      update();
      return {
        insets: function (ins) { place(ins); },
        resize: function () { place(); },
        destroy: function () { workSurface = null; }
      };
    },
    primary: { label: 'Step done, or count one unit', run: function (api) {
      var p = api.project();
      if (!p) return;
      advance(p.id);
      api.refresh();
    } },
    forward: { label: 'Step done, next step', glyph: '›', word: 'Next', run: function (api) {
      var p = api.project();
      if (!p) return;
      stepDone(p.id);
      api.refresh();
    } },
    back: { label: 'Back a step', glyph: '‹', word: 'Back', run: function (api) {
      var p = api.project();
      if (!p) return;
      var d = dataOf(p);
      if (d.currentStep <= 0) { C.toast('This is the first step'); return; }
      edit(p.id, function (dd) { dd.currentStep = Math.max(0, dd.currentStep - 1); }, 'step');
      var fresh = dataOf(Store.project(p.id));
      C.announce(stepWhere(fresh, fresh.currentStep));
      paint(Store.project(p.id));
      api.refresh();
    } },
    undo: true,
    secondary: [{
      id: 'unit-minus', side: 'start', glyph: '−1', label: 'Take one off this unit',
      hidden: function (api) { var p = api.project(); return !(p && activeUnitOf(dataOf(p))); },
      run: function (api) {
        var p = api.project();
        var au = p ? activeUnitOf(dataOf(p)) : null;
        if (au) bumpUnit(p.id, au.unit.id, -1);
        api.refresh();
      }
    }],
    readout: function (api) {
      var p = api.project();
      if (!p) return {};
      var d = dataOf(p);
      if (workSurface) workSurface.update();
      var total = d.steps.length;
      if (!total) return { title: p.name, line: { tag: '', text: 'No steps yet. Import the pattern from the ⋯ menu.' }, say: 'No steps yet' };
      var at = Math.min(d.currentStep, total - 1);
      var st = d.steps[at];
      var w = workWhere(d, at);
      var where = stepWhere(d, at);
      var au = activeUnitOf(d);
      var cells = [{
        cap: st.optional ? 'EXTRA' : 'STEP',
        big: w.pos ? String(w.pos.n) : '+',
        of: w.pos ? '/ ' + w.pos.runTotal : '',
        sub: w.pos && w.pos.cards > 1 ? 'card ' + w.pos.card + ' of ' + w.pos.cards : (st.section || ''),
        label: where
      }];
      if (au) {
        cells.push({ cap: String(au.unit.name).toUpperCase(), big: String(au.unit.done), of: '/ ' + au.unit.target,
          sub: au.unit.size || '', label: au.unit.name + ', ' + au.unit.done + ' of ' + au.unit.target + ' made' });
      }
      var hints = [];
      var setup = setupOf(st, d);
      if (setup && setup.chips) {
        setup.chips.forEach(function (c) {
          var label = c.label;
          // The seam allowance in the pattern's own unit first, as on the step card.
          if (c.kind === 'sa' && setup.sa && typeof setup.sa.mm === 'number') {
            label = 'Seam allowance ' + mmLabel(setup.sa.mm, setup.sa.inches, unitsOf(d, null)) +
              (setup.sa.source === 'step' ? ' · this step' : (setup.sa.part ? ' · ' + setup.sa.part : ''));
          }
          hints.push({ text: (c.kind === 'foot' ? '🦶 ' : ((c.kind === 'press' || c.kind === 'fuse') ? '⏱ ' : '')) + label, cls: 'sw-work-hint sw-work-' + c.kind });
        });
      } else {
        var sa = saLabel(d);
        if (sa) hints.push(sa);
      }
      stepSizeItems(resolvedFor(p, d), st).slice(0, 3).forEach(function (it) {
        hints.push({ text: 'Size ' + d.size.chosen + ': ' + sizeItemText(it, 26), cls: 'sw-work-size' });
      });
      if (st.note) hints.push({ text: '📝 ' + clip(st.note, 120), cls: 'sw-work-note' });
      var nx = null;
      for (var k = at + 1; k < total; k++) {
        if (!d.steps[k].optional || st.optional) { nx = k; break; }
      }
      var next = nx === null ? { tag: 'Next', text: 'That is the last step' }
        : { tag: 'Next', text: stepWhere(d, nx).replace(/ of \d+/, '') + ' · ' + clip(d.steps[nx].text.replace(/^\(continued\)\s*/i, ''), 90) };
      if (api.surface && api.surface.setAttribute) {
        api.surface.setAttribute('aria-label', au ? 'Count one ' + au.unit.name : 'Step done');
      }
      // Four corner buttons (−1 shown): css/sewing.css drops their words on a narrow phone.
      // A class, not only :has(), so older Safari gets it too.
      var hud = document.querySelector('.work-hud.sw-work');
      if (hud) hud.classList.toggle('sw-work-four', !!au);
      return {
        title: p.name,
        cells: cells,
        line: { tag: '', text: st.text },
        hints: hints,
        next: next,
        tip: au ? 'Tap: one more ' + au.unit.name + ' · Next: step done'
          : (st.done ? 'Already done · Next moves on' : 'Tap here when the step is done'),
        say: where + (au ? '. ' + au.unit.name + ' ' + au.unit.done + ' of ' + au.unit.target : '')
      };
    },
    panel: function (body, api) {
      var p = api.project();
      if (!p) return;
      function action(text, fn) {
        var b = C.button('btn ghost block', text);
        C.on(b, 'click', function () { fn(); });
        body.appendChild(b);
      }
      action('📝 Note on this step', function () { var pr = api.project(); if (pr) openStepNote(pr.id, dataOf(pr).currentStep); });
      action('📄 The page for this step', function () { var pr = api.project(); if (pr) openStepFigure(pr.id, dataOf(pr).currentStep); });
      action('☰ Step list', function () { var pr = api.project(); if (pr) openStepsSheet(pr.id); });
    },
    onClose: function () {
      var p = viewProjectId ? Store.project(viewProjectId) : null;
      if (p) paint(p);
    }
  };

  /* ================================================================== *
   * 3. The "Step done ✓" gesture
   * ================================================================== */

  var MOVE_TOLERANCE_SQ = 144;   // 12px, the same as the crochet stitch button

  function wireStepButton(btn) {
    var startX = 0, startY = 0, tracking = false;

    C.on(btn, 'pointerdown', function (e) {
      if (btn.disabled) return;
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
      btn.classList.add('pressed');
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      // Nothing is counted here: press-and-release counts, exactly like crochet.
    });

    C.on(btn, 'pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      btn.classList.remove('pressed');
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (dx * dx + dy * dy > MOVE_TOLERANCE_SQ) return;   // a scroll, not a tap
      advance();
    });

    C.on(btn, 'pointercancel', function () {
      tracking = false;
      btn.classList.remove('pressed');
    });
    C.on(btn, 'pointerleave', function () {
      if (!tracking) btn.classList.remove('pressed');
    });

    // Keyboard activation (Enter / Space) arrives as a click with detail 0.
    C.on(btn, 'click', function (e) {
      if (e.detail === 0 && !btn.disabled) advance();
    });
  }

  /** The big button: +1 on the unit this step makes, else Step done (P10). */
  function advance(projectId) {
    var p = Store.project(projectId || viewProjectId);
    if (!p) return;
    var au = activeUnitOf(dataOf(p));
    if (au) { bumpUnit(p.id, au.unit.id, 1); return; }
    stepDone(p.id);
  }

  function stepDone(projectId) {
    var p = Store.project(projectId || viewProjectId);
    if (!p) return;
    var before = dataOf(p);
    if (!before.steps.length) return;
    var at = Math.min(before.currentStep, before.steps.length - 1);
    if (before.steps[at].done && at === before.steps.length - 1) {
      C.toast('Every step is done 🎉');
      return;
    }

    edit(p.id, function (d) {
      var i = Math.min(d.currentStep, d.steps.length - 1);
      d.steps[i].done = true;
      d.currentStep = Math.min(i + 1, d.steps.length - 1);
    }, 'step');
    if (!before.steps[at].done) recordCount(p.id, 1, 'step', before.steps[at].section || null);

    var fresh = Store.project(p.id);
    var d = dataOf(fresh);
    // Counted in PRINTED steps (a step is done when all its cards are); the
    // optional extras never block finishing, and ticking one later does not
    // re-celebrate.
    var ps = S.printedSteps(d.steps), psB = S.printedSteps(before.steps);
    var total = ps.total || d.steps.length;
    var done = ps.total ? S.printedDone(d.steps, ps) : stepsDone(d);
    var doneBefore = psB.total ? S.printedDone(before.steps, psB) : stepsDone(before);

    C.fb('row');
    paint(fresh);
    refreshWork();

    if (done >= total && doneBefore < total) {
      C.announce('All ' + total + ' steps done');
      C.celebrate('project');
      try { Store.setStatus(fresh.id, 'finished'); } catch (e) { /* ignore */ }
      C.toast('Every step is done 🎉 — marked finished');
      C.render();
      return;
    }

    C.announce(stepWhere(d, d.currentStep));
    if (done > doneBefore && done % 10 === 0) {
      C.celebrate('piece');
      C.toast(done + ' steps done');
    }
  }

  /* ================================================================== *
   * 4. Sheets
   * ================================================================== */

  function sheetHeadLine(text) {
    return C.el('p', 'muted sw-sheet-head', text);
  }

  // --- Steps -------------------------------------------------------------

  /**
   * The step list. opts.toolsAt opens the split / merge tools on that card
   * (the step card's "✂ Split this card" lands here). Optional extras
   * (variations, hacks, care notes) sit in a collapsed group after the
   * construction and are never counted (05 #3, Wave F).
   */
  function openStepsSheet(projectId, opts) {
    opts = opts || {};
    var p = Store.project(projectId);
    if (!p) return;
    var toolsAt = typeof opts.toolsAt === 'number' ? opts.toolsAt : -1;
    var optionalOpen = null;     // null: open only when you are on an extra
    var scrolled = false;
    var api = C.openSheet({
      title: 'Steps',
      cls: 'sheet-sewing',
      build: function (body) { renderSteps(body); }
    });

    function rebuild(body) {
      if (C.preserveFocus) C.preserveFocus(function () { renderSteps(body); });
      else renderSteps(body);
    }

    function renderSteps(body) {
      C.clear(body);
      var proj = Store.project(projectId);
      if (!proj) { api.close(); return; }
      var d = dataOf(proj);
      var ps = S.printedSteps(d.steps);
      var optIdx = [];
      for (var oi = 0; oi < d.steps.length; oi++) if (d.steps[oi].optional) optIdx.push(oi);
      body.appendChild(sheetHeadLine(
        !d.steps.length ? 'No steps yet.'
          : (ps.total ? S.printedDone(d.steps, ps) + ' of ' + plural(ps.total, 'step') + ' done' : stepsDone(d) + ' of ' + d.steps.length + ' done') +
            (optIdx.length ? ' · ' + plural(optIdx.length, 'optional extra') : '')
      ));
      var tools = {
        at: toolsAt,
        toggle: function (i) { toolsAt = toolsAt === i ? -1 : i; rebuild(body); },
        split: function (i, at) { doSplit(body, i, at); },
        merge: function (i) { doMerge(body, i); },
        edit: function (i) { openStepEdit(projectId, i, function () { rebuild(body); }); },
        note: function (i) { openStepNote(projectId, i); }
      };

      var list = C.el('div', 'list sw-steps');
      var section = null;
      for (var i = 0; i < d.steps.length; i++) {
        var st = d.steps[i];
        if (st.optional) continue;
        if (st.section !== section) {
          section = st.section;
          if (section) list.appendChild(C.el('div', 'sw-section-head', section));
        }
        appendStepRow(list, proj, d, st, i, rebuild, body, tools);
      }
      body.appendChild(list);

      if (optIdx.length) {
        var onExtra = d.steps[Math.min(d.currentStep, d.steps.length - 1)].optional || (toolsAt >= 0 && d.steps[toolsAt] && d.steps[toolsAt].optional);
        var det = document.createElement('details');
        det.className = 'sw-optional';
        det.open = optionalOpen === null ? !!onExtra : optionalOpen;
        var sum = document.createElement('summary');
        sum.className = 'sw-optional-head';
        sum.textContent = 'Optional — ' + plural(optIdx.length, 'extra') + ', not counted';
        det.appendChild(sum);
        C.on(det, 'toggle', function () { optionalOpen = det.open; });
        det.appendChild(C.el('p', 'field-hint sw-optional-hint',
          'Variations, hacks and care notes from the pattern. They never count toward your progress.'));
        var olist = C.el('div', 'list sw-steps');
        var osec = null;
        optIdx.forEach(function (ix) {
          var ost = d.steps[ix];
          if (ost.section !== osec) {
            osec = ost.section;
            if (osec) olist.appendChild(C.el('div', 'sw-section-head', osec));
          }
          appendStepRow(olist, proj, d, ost, ix, rebuild, body, tools);
        });
        det.appendChild(olist);
        body.appendChild(det);
      }

      if (!scrolled && toolsAt >= 0) {
        scrolled = true;
        window.setTimeout(function () {
          var at = body.querySelector('.sw-step-tools-panel');
          if (at && at.scrollIntoView) at.scrollIntoView({ block: 'center' });
        }, 60);
      }

      var add = C.button('btn ghost block', '＋ Add step');
      C.on(add, 'click', function () {
        var input = C.textInput('', 'Sew the side seams');
        C.openSheet({
          title: 'Add a step',
          build: function (b2) { b2.appendChild(C.field('Step', input)); window.setTimeout(function () { input.focus(); }, 60); },
          footer: [
            { text: 'Cancel', cls: 'btn ghost', onClick: function (a) { a.close(); } },
            {
              text: 'Add', cls: 'btn primary',
              onClick: function (a) {
                var text = input.value.replace(/^\s+|\s+$/g, '');
                if (!text) { a.close(); return; }
                edit(projectId, function (dd) {
                  // After the last construction card, before the optional
                  // extras, numbered after the last printed step (Wave F).
                  var at = dd.steps.length, maxN = 0;
                  for (var q = 0; q < dd.steps.length; q++) {
                    if (dd.steps[q].optional) { if (at === dd.steps.length) at = q; continue; }
                    maxN = dd.steps[q].n || maxN;   // the last card's number (a restart counts its own run)
                  }
                  dd.steps.splice(at, 0, {
                    id: 'sw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    n: maxN + 1, section: '', text: text, done: false, page: null, imageRef: null
                  });
                  if (dd.currentStep >= at && at < dd.steps.length - 1) dd.currentStep++;
                });
                a.close();
                renderSteps(body);
                paint(Store.project(projectId));
              }
            }
          ]
        });
      });
      body.appendChild(add);

      // A project imported with "Just keep the text" has the whole booklet but
      // no steps: this turns it into steps whenever the sewist is ready.
      if (d.sourceText) {
        var fromText = C.button('btn ghost block', '＋ Steps from the pattern text');
        C.on(fromText, 'click', function () {
          addStepsFromText(projectId, d.sourceText, function () {
            renderSteps(body);
            paint(Store.project(projectId));
          });
        });
        body.appendChild(fromText);
        body.appendChild(C.el('p', 'field-hint',
          d.steps.length
            ? 'Adds more steps from the pattern text you imported.'
            : 'The pattern text was kept — pick the paragraphs that are steps.'));
      }

      if (stepsDone(d)) {
        var clearDone = C.button('linkish block', 'Clear all done');
        C.on(clearDone, 'click', function () {
          C.confirmSheet({
            title: 'Clear all done?',
            message: 'Every step goes back to not done and you start again at step 1.',
            confirmText: 'Clear'
          }).then(function (ok) {
            if (!ok) return;
            edit(projectId, function (dd) {
              for (var k = 0; k < dd.steps.length; k++) dd.steps[k].done = false;
              dd.currentStep = 0;
            });
            renderSteps(body);
            paint(Store.project(projectId));
          });
        });
        body.appendChild(clearDone);
      }
    }

    /** Split card `index` before its sentence `at`; one undo step, with an Undo toast. */
    function doSplit(body, index, at) {
      var before = dataOf(Store.project(projectId));
      var st = before.steps[index];
      if (!st || !(at >= 1 && at < S.sentences(st.text).length)) { C.toast('That card cannot be split there'); return; }
      edit(projectId, function (dd) { S.splitStep(dd, index, at); });
      toolsAt = -1;
      var fresh = dataOf(Store.project(projectId));
      var pos = S.printedSteps(fresh.steps).of[index];
      var msg = pos
        ? 'Step ' + pos.n + ' is now ' + pos.cards + ' cards'
        : 'Split into two cards';
      afterStepEdit(body, msg, index);
    }

    /** Join card `index` with the card after it. */
    function doMerge(body, index) {
      var before = dataOf(Store.project(projectId));
      var a = before.steps[index], b = before.steps[index + 1];
      if (!a || !b || !!a.optional !== !!b.optional) { C.toast('There is no card after this one to merge with'); return; }
      edit(projectId, function (dd) { S.mergeSteps(dd, index); });
      toolsAt = -1;
      var fresh = dataOf(Store.project(projectId));
      var pos = S.printedSteps(fresh.steps).of[index];
      afterStepEdit(body, pos ? 'Merged into step ' + pos.n + (pos.cards > 1 ? ', card ' + pos.card + ' of ' + pos.cards : '') : 'Merged the two cards', index);
    }

    function afterStepEdit(body, msg, index) {
      C.fb('tap');
      var hadFocus = document.activeElement && body.contains(document.activeElement);
      rebuild(body);
      // The control that was pressed is gone with its panel; keyboard focus
      // goes back to the card's ✎.
      var back = hadFocus ? body.querySelector('[data-focus-key="tool-' + index + '"]') : null;
      if (back) { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      paint(Store.project(projectId));
      C.announce(msg);
      C.toast(msg, {
        actionText: 'Undo',
        onAction: function () {
          if (Store.undo()) { C.fb('undo'); C.toast('Undone'); }
          if (api && api.dialog && api.dialog.open) rebuild(body);
          C.render();
        }
      });
    }
  }

  /** A step row, plus its split / merge panel when that is open. */
  function appendStepRow(list, proj, d, st, index, rerender, body, tools) {
    list.appendChild(stepRow(proj, d, st, index, rerender, body, tools));
    if (tools && tools.at === index) list.appendChild(stepToolsPanel(d, st, index, tools));
  }

  /**
   * "Split here": one choice per sentence boundary, as in the import's
   * paragraph picker; "Merge with the next card" below. Both keep the printed
   * step number, so the list reads "4 · 1/2", "4 · 2/2" (05 #1, Wave F).
   */
  function stepToolsPanel(d, st, index, tools) {
    var panel = C.el('div', 'list-item sw-step-tools-panel');
    var sentences = S.sentences(st.text) || [];
    var pos = S.printedSteps(d.steps).of[index];
    var name = pos ? 'step ' + pos.n : 'this extra';
    if (tools.edit) {
      var own = C.el('div', 'sw-step-own');
      var eb = C.button('btn ghost sw-step-edit', '✎ Edit the text', 'Edit the text of ' + name);
      eb.setAttribute('data-focus-key', 'edit-' + index);
      C.on(eb, 'click', function () { tools.edit(index); });
      var nb = C.button('btn ghost sw-step-notebtn', st.note ? '📝 Edit your note' : '📝 Add a note', (st.note ? 'Edit your note on ' : 'Add a note to ') + name);
      nb.setAttribute('data-focus-key', 'note-' + index);
      C.on(nb, 'click', function () { tools.note(index); });
      own.appendChild(eb);
      own.appendChild(nb);
      panel.appendChild(own);
    }
    if (sentences.length > 1) {
      panel.appendChild(C.el('div', 'sw-para-split-head', 'Split here — start a new card at…'));
      for (var s = 1; s < sentences.length; s++) {
        (function (at) {
          var b = C.button('sw-para-split-opt', null, 'Split ' + name + ' before: ' + clip(sentences[at], 60));
          b.setAttribute('data-focus-key', 'split-' + index + '-' + at);
          b.appendChild(C.el('span', 'sw-para-split-mark', '⤵'));
          b.appendChild(C.el('span', 'sw-para-split-text', clip(sentences[at], 80)));
          C.on(b, 'click', function () { tools.split(index, at); });
          panel.appendChild(b);
        })(s);
      }
    } else {
      panel.appendChild(C.el('p', 'field-hint', 'This card is a single sentence, so there is nowhere to split it.'));
    }
    var next = d.steps[index + 1];
    if (next && !!next.optional === !!st.optional) {
      var m = C.button('btn ghost block sw-merge', '⤒ Merge with the next card', 'Merge ' + name + ' with the next card');
      m.setAttribute('data-focus-key', 'merge-' + index);
      C.on(m, 'click', function () { tools.merge(index); });
      panel.appendChild(m);
      panel.appendChild(C.el('p', 'field-hint sw-merge-next', 'Next: ' + clip(next.text.replace(/^\(continued\)\s*/i, ''), 70)));
    }
    return panel;
  }

  function stepRow(proj, d, st, index, rerender, body, tools) {
    var row = C.el('div', 'list-item sw-step-row' + (st.done ? ' done' : '') + (index === d.currentStep ? ' current' : ''));
    // The printed number, as on the paper; a step on several cards shows its
    // card ('4 · 2/3'); an optional extra shows '+'.
    var pos = S.printedSteps(d.steps).of[index];
    var rowN = pos ? (pos.cards > 1 ? pos.n + ' · ' + pos.card + '/' + pos.cards : pos.n + '.') : '+';
    var rowName = pos ? 'step ' + pos.n + (pos.cards > 1 ? ', card ' + pos.card + ' of ' + pos.cards : '') : 'optional extra';
    var check = C.button('check', '✓', (st.done ? 'Mark ' + rowName + ' not done' : 'Mark ' + rowName + ' done'));
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', st.done ? 'true' : 'false');
    C.on(check, 'click', function () {
      edit(proj.id, function (dd) {
        if (dd.steps[index]) dd.steps[index].done = !dd.steps[index].done;
      }, 'step');
      recordCount(proj.id, st.done ? -1 : 1, 'step', st.section || null);
      C.fb('tap');
      rerender(body);
      paint(Store.project(proj.id));
      refreshWork();
    });

    var textBtn = C.button('item-text sw-step-jump', null, 'Jump to ' + rowName);
    textBtn.appendChild(C.el('span', 'sw-step-row-n', rowN));
    textBtn.appendChild(C.el('span', 'sw-step-row-text', clip(st.text, 70)));
    if (st.edited) textBtn.appendChild(C.el('span', 'sw-step-row-mark', '✎'));
    if (st.note) textBtn.appendChild(C.el('span', 'sw-step-row-mark', '📝'));
    if (figureRef(st) && figureRef(st).kind === 'crop') textBtn.appendChild(C.el('span', 'sw-step-row-mark', '🖼'));
    C.on(textBtn, 'click', function () {
      jumpToStep(proj.id, index, function () { rerender(body); });
    });

    row.appendChild(check);
    row.appendChild(textBtn);
    if (typeof st.page === 'number') {
      row.appendChild(C.el('span', 'chip sw-page-chip', 'p' + st.page));
    }
    if (tools) {
      var open = tools.at === index;
      var tool = C.button('sw-para-tool sw-step-tool' + (open ? ' on' : ''), '✎',
        (open ? 'Close the tools for ' : 'Edit, note, split or merge ') + rowName);
      tool.setAttribute('aria-expanded', open ? 'true' : 'false');
      tool.setAttribute('data-focus-key', 'tool-' + index);
      C.on(tool, 'click', function () { tools.toggle(index); });
      row.appendChild(tool);
    }
    return row;
  }

  function jumpToStep(projectId, index, after) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    var backwards = index < d.currentStep;
    var anyDoneAfter = false;
    for (var i = index; i < d.steps.length; i++) if (d.steps[i].done) anyDoneAfter = true;

    function go() {
      edit(projectId, function (dd) { dd.currentStep = Math.max(0, Math.min(index, dd.steps.length - 1)); });
      paint(Store.project(projectId));
      C.announce(stepWhere(dataOf(Store.project(projectId)), index));
      if (after) after();
    }

    if (backwards && anyDoneAfter) {
      C.confirmSheet({
        title: 'Go back to ' + stepWhere(d, index).replace(/^Step/, 'step').replace(/ of \d+/, '') + '?',
        message: 'Steps you have already ticked off stay ticked — this only moves where you are.',
        confirmText: 'Go back'
      }).then(function (ok) { if (ok) go(); });
      return;
    }
    go();
  }

  // --- Steps from paragraphs (the "no numbered steps" recovery path) ------

  /**
   * The picker behind "Make steps from paragraphs". Every paragraph in the
   * booklet is offered; the construction prose starts ticked and the glossary,
   * size chart and cutting list start unticked (Sewing.paragraphCandidates
   * scores them). ↑ joins a paragraph to the one above, ✂ splits one at a
   * sentence boundary — the two things a run of prose always needs.
   *
   * opts = { text, title?, onUse(stepRows) }
   */
  function openParagraphPicker(opts) {
    var text = String((opts && opts.text) || '');
    var items = [];
    try {
      items = (S.paragraphCandidates(text) || []).map(function (c) {
        return {
          text: String(c.text || ''), page: c.page, section: String(c.section || ''),
          on: !!c.defaultOn, open: false, splitAt: -1
        };
      });
    } catch (e) { items = []; }
    items = items.filter(function (it) { return it.text; });
    if (!items.length) {
      C.toast('There are no paragraphs here to turn into steps', { ms: 3600 });
      return;
    }

    var listNode = null, headNode = null, useBtn = null;

    var api = C.openSheet({
      title: opts.title || 'Make steps from paragraphs',
      cls: 'sheet-sewing sheet-para',
      build: function (body) {
        body.appendChild(C.el('p', 'muted',
          'Tick the paragraphs that are really steps. ↑ joins one to the paragraph above, ✂ splits a long one.'));

        var bar = C.el('div', 'sw-para-bar');
        headNode = C.el('span', 'sw-para-count', '');
        var all = C.button('linkish', 'Tick all');
        var none = C.button('linkish', 'Untick all');
        C.on(all, 'click', function () { setAll(true); });
        C.on(none, 'click', function () { setAll(false); });
        bar.appendChild(headNode);
        bar.appendChild(all);
        bar.appendChild(none);
        body.appendChild(bar);

        listNode = C.el('div', 'list sw-para-list');
        body.appendChild(listNode);
        renderList();
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (a) { a.close(); } },
        {
          text: 'Use these', cls: 'btn primary',
          onClick: function (a) {
            var picked = [];
            items.forEach(function (it) { if (it.on) picked.push(it); });
            if (!picked.length) { C.toast('Tick at least one paragraph first'); return; }
            a.close();
            if (opts.onUse) {
              opts.onUse(picked.map(function (it, i) {
                return { n: i + 1, section: it.section, text: it.text, page: it.page, marker: 'none' };
              }));
            }
          }
        }
      ]
    });

    // The footer's last button is "Use these".
    window.setTimeout(function () {
      var foot = api.dialog.querySelector('.sheet-foot');
      if (foot) useBtn = foot.lastChild;
      syncHead();
    }, 0);

    function chosen() {
      var n = 0;
      items.forEach(function (it) { if (it.on) n++; });
      return n;
    }
    function syncHead() {
      var n = chosen();
      if (headNode) headNode.textContent = n + ' of ' + items.length + ' chosen';
      if (useBtn) useBtn.disabled = !n;
    }
    function setAll(on) {
      items.forEach(function (it) { it.on = on; });
      C.fb('tap');
      renderList();
    }
    function renderList() {
      if (!listNode) return;
      C.clear(listNode);
      for (var i = 0; i < items.length; i++) listNode.appendChild(paraRow(i));
      syncHead();
    }

    function paraRow(index) {
      var it = items[index];
      var row = C.el('div', 'list-item sw-para-row' + (it.on ? ' on' : ''));

      var check = C.button('check' + (it.on ? ' on' : ''), '✓',
        (it.on ? 'Do not use paragraph ' : 'Use paragraph ') + (index + 1));
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', it.on ? 'true' : 'false');
      C.on(check, 'click', function () {
        it.on = !it.on;
        C.fb('tap');
        renderList();
      });
      row.appendChild(check);

      var main = C.el('div', 'sw-para-main');
      var meta = [];
      if (it.section) meta.push(it.section);
      if (typeof it.page === 'number') meta.push('p' + it.page);
      if (meta.length) main.appendChild(C.el('div', 'sw-para-meta', meta.join(' · ')));

      var body = C.button('sw-para-text' + (it.open ? ' open' : ''), null,
        it.open ? 'Show less of paragraph ' + (index + 1) : 'Show all of paragraph ' + (index + 1));
      body.appendChild(C.el('span', null, it.open ? it.text : clip(it.text, 130)));
      C.on(body, 'click', function () { it.open = !it.open; renderList(); });
      main.appendChild(body);

      var tools = C.el('div', 'sw-para-tools');
      var up = C.button('sw-para-tool', '↑', 'Join this paragraph to the one above');
      up.disabled = index === 0;
      C.on(up, 'click', function () { mergeUp(index); });
      tools.appendChild(up);

      var sentences = S.sentences(it.text) || [];
      var cut = C.button('sw-para-tool' + (it.splitAt >= 0 ? ' on' : ''), '✂', 'Split this paragraph');
      cut.disabled = sentences.length < 2;
      C.on(cut, 'click', function () {
        it.splitAt = it.splitAt >= 0 ? -1 : 0;
        renderList();
      });
      tools.appendChild(cut);
      main.appendChild(tools);

      if (it.splitAt >= 0 && sentences.length > 1) {
        var picker = C.el('div', 'sw-para-split');
        picker.appendChild(C.el('div', 'sw-para-split-head', 'Start a new step at…'));
        for (var s = 1; s < sentences.length; s++) {
          picker.appendChild(splitChoice(index, sentences, s));
        }
        main.appendChild(picker);
      }

      row.appendChild(main);
      return row;
    }

    function splitChoice(index, sentences, at) {
      var b = C.button('sw-para-split-opt', null, 'Split before: ' + clip(sentences[at], 60));
      b.appendChild(C.el('span', 'sw-para-split-mark', '⤵'));
      b.appendChild(C.el('span', 'sw-para-split-text', clip(sentences[at], 70)));
      C.on(b, 'click', function () { splitAt(index, sentences, at); });
      return b;
    }

    function mergeUp(index) {
      if (index < 1) return;
      var prev = items[index - 1], it = items[index];
      prev.text = (prev.text + ' ' + it.text).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      prev.on = prev.on || it.on;
      prev.splitAt = -1;
      items.splice(index, 1);
      C.fb('tap');
      renderList();
      C.announce('Joined — ' + items.length + ' paragraphs left');
    }

    function splitAt(index, sentences, at) {
      var it = items[index];
      var head = sentences.slice(0, at).join(' ').replace(/^\s+|\s+$/g, '');
      var tail = sentences.slice(at).join(' ').replace(/^\s+|\s+$/g, '');
      if (!head || !tail) return;
      it.text = head;
      it.splitAt = -1;
      items.splice(index + 1, 0, {
        text: tail, page: it.page, section: it.section, on: it.on, open: false, splitAt: -1
      });
      C.fb('tap');
      renderList();
      C.announce('Split — ' + items.length + ' paragraphs');
    }
  }

  /** Append picked paragraphs to a project's step list. */
  function addStepsFromText(projectId, text, after) {
    openParagraphPicker({
      text: text,
      onUse: function (rows) {
        var added = 0;
        edit(projectId, function (dd) {
          for (var i = 0; i < rows.length; i++) {
            if (dd.steps.length >= 400) break;
            dd.steps.push({
              id: newId('s'), n: dd.steps.length + 1, section: rows[i].section,
              text: rows[i].text, done: false, page: rows[i].page, imageRef: null
            });
            added++;
          }
        });
        C.toast('Added ' + plural(added, 'step') + ' from the pattern text');
        C.fb('done');
        if (after) after();
      }
    });
  }

  // --- Cutting -----------------------------------------------------------

  function openCuttingSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var api = C.openSheet({
      title: 'Cutting list',
      cls: 'sheet-sewing',
      build: function (body) { renderCutting(body); }
    });

    function renderCutting(body) {
      C.clear(body);
      var proj = Store.project(projectId);
      if (!proj) { api.close(); return; }
      var d = dataOf(proj);
      var tot = S.cutTotals(d);
      body.appendChild(sheetHeadLine(
        d.cutting.length
          ? cutLine(d) + (tot.rows > 1 ? ' · ' + tot.rowsDone + ' of ' + tot.rows + ' rows done' : '')
          : (d.sourceText ? 'No cutting list was found in the instructions.' : 'No pieces yet.')
      ));
      // Where the pattern lays its pieces out (05 #7, Wave F): booklets that
      // keep the cutting list on the pattern sheets still print the layouts.
      var lp = d.sourceText ? S.layoutPages(d.sourceText) : [];
      if (lp.length) {
        var lay = C.el('div', 'sw-layouts');
        lay.appendChild(C.el('span', 'sw-layouts-label', lp.length > 1 ? 'Cutting layouts' : 'Cutting layout'));
        lp.forEach(function (n) {
          var has = !!pageRow(d, n);
          var chip = C.button('chip sw-page' + (has ? '' : ' sw-page-plain'), '📄 page ' + n,
            has ? 'Show the cutting layout on page ' + n : 'The cutting layout is on page ' + n + ' of the booklet');
          chip.disabled = !has;
          C.on(chip, 'click', function () { if (has) openPageViewer(projectId, n); });
          lay.appendChild(chip);
        });
        body.appendChild(lay);
        if (!lp.some(function (n) { return !!pageRow(d, n); })) {
          body.appendChild(C.el('p', 'field-hint sw-layouts-hint', d.pages.length
            ? 'That page was not kept on this device — look at it in the PDF.'
            : 'Import the PDF with “Keep the pages” ticked to see it here.'));
        }
      }
      if (!d.cutting.length && d.sourceText) {
        body.appendChild(C.el('p', 'muted',
          'Many booklets keep the piece list on the pattern sheets. Add the pieces you need to cut and the ' +
          'counters keep track as you go.'));
      }
      var nap = napBlock(projectId, d);
      if (nap) body.appendChild(nap);

      MATERIAL_ORDER.forEach(function (mat) {
        var rows = [];
        for (var i = 0; i < d.cutting.length; i++) if (d.cutting[i].material === mat) rows.push({ row: d.cutting[i], index: i });
        if (!rows.length) return;

        var head = C.el('div', 'sw-group-head');
        head.appendChild(C.el('span', null, MATERIAL_NAMES[mat] + ' · ' + plural(rows.length, 'piece')));
        var cutAll = C.button('linkish sw-cut-all', 'Cut all', 'Mark every ' + MATERIAL_NAMES[mat] + ' piece cut');
        C.on(cutAll, 'click', function () {
          edit(projectId, function (dd) {
            for (var k = 0; k < dd.cutting.length; k++) {
              if (dd.cutting[k].material === mat) dd.cutting[k].cutCount = dd.cutting[k].qty;
            }
          });
          C.fb('group');
          renderCutting(body);
          afterCut(projectId);
        });
        head.appendChild(cutAll);
        body.appendChild(head);

        var list = C.el('div', 'list');
        rows.forEach(function (r) { list.appendChild(cutRowNode(proj, r.row, r.index, body, renderCutting)); });
        body.appendChild(list);
      });

      var add = C.button('btn ghost block', '＋ Add a piece');
      C.on(add, 'click', function () { openCutEditor(projectId, null, function () { renderCutting(body); }); });
      body.appendChild(add);
    }
  }

  /**
   * The booklet's own nap-direction sentences (Sewing.napNotes), quoted with their page,
   * on the cutting and fabric sheets: a pile fabric cut the wrong way up cannot be undone.
   */
  function napBlock(projectId, d) {
    if (!S.napNotes || !d.sourceText) return null;
    var notes = [];
    try { notes = S.napNotes(d.sourceText) || []; } catch (e) { notes = []; }
    if (!notes.length) return null;
    var box = C.el('section', 'card sw-nap');
    box.setAttribute('aria-label', 'Nap direction, as the pattern says');
    box.appendChild(C.el('div', 'sw-nap-head', '↕ Nap direction · the pattern says'));
    notes.slice(0, 4).forEach(function (n) {
      var q = C.el('p', 'sw-nap-text', '“' + clip(n.text, 220) + '”');
      if (typeof n.page === 'number') {
        var has = !!pageRow(d, n.page);
        var pg = C.button('chip sw-page' + (has ? '' : ' sw-page-plain'), 'page ' + n.page,
          has ? 'Show page ' + n.page : 'This is on page ' + n.page + ' of the booklet');
        pg.disabled = !has;
        C.on(pg, 'click', function () { if (has) openPageViewer(projectId, n.page); });
        q.appendChild(document.createTextNode(' '));
        q.appendChild(pg);
      }
      box.appendChild(q);
    });
    return box;
  }

  // Up to this many, a tap on the chip counts one; above it (a quilt's 56
  // squares) the chip opens a stepper with ±10 and all / none (05 #3).
  var CUT_TAP_MAX = 6;

  /** Set a row's cut count (clamped), announce it, repaint. */
  function setCut(projectId, index, value, rerender, body) {
    var before = dataOf(Store.project(projectId)).cutting[index];
    if (!before) return;
    var v = Math.max(0, Math.min(before.qty, value | 0));
    if (v === before.cutCount) return;
    edit(projectId, function (dd) { if (dd.cutting[index]) dd.cutting[index].cutCount = v; }, 'cut');
    recordCount(projectId, v - before.cutCount, 'cut', before.piece, before.qty);
    C.fb(v < before.cutCount ? 'undo' : 'tap');
    C.announce(before.piece + ', ' + v + ' of ' + before.qty + ' cut');
    if (rerender) {
      if (C.preserveFocus) C.preserveFocus(function () { rerender(body); });
      else rerender(body);
    }
    afterCut(projectId);
  }

  function cutRowNode(proj, row, index, body, rerender) {
    var node = C.el('div', 'list-item sw-cut-row' + (row.cutCount >= row.qty ? ' done' : ''));
    var big = row.qty > CUT_TAP_MAX;
    var counter = C.el('div', 'sw-cut-counter');
    var minus = C.button('sw-cut-minus', '−', 'One fewer ' + row.piece + ' cut');
    minus.disabled = row.cutCount <= 0;
    minus.setAttribute('data-focus-key', 'cut-minus-' + row.id);
    C.on(minus, 'click', function () { setCut(proj.id, index, row.cutCount - 1, rerender, body); });
    var full = row.cutCount >= row.qty;
    var chip = C.button('chip sw-count-chip' + (big ? ' sw-count-big' : ''),
      (full ? '✓ ' : '') + row.cutCount + ' of ' + row.qty + ' cut' + (big ? ' ▸' : ''),
      row.piece + ', ' + row.cutCount + ' of ' + row.qty + ' cut. ' +
      (big ? 'Opens a counter to set how many are cut' : (full ? 'All cut' : 'Tap when you have cut one more')));
    chip.setAttribute('data-focus-key', 'cut-chip-' + row.id);
    C.on(chip, 'click', function () {
      if (big) { openCutCount(proj.id, index, rerender, body); return; }
      if (row.cutCount >= row.qty) { C.toast('All ' + row.qty + ' cut — use − to take one off'); return; }
      setCut(proj.id, index, row.cutCount + 1, rerender, body);
    });
    counter.appendChild(minus);
    counter.appendChild(chip);

    var mid = C.button('item-text sw-cut-text', null, 'Edit ' + row.piece);
    mid.appendChild(C.el('span', 'sw-cut-name', row.piece));
    var sub = [];
    // A quilt piece is named by its size ('10 1/2" x 4 1/2" rectangle'): no need to print it twice.
    if (row.dims && row.piece.replace(/\s+/g, '').indexOf(row.dims.replace(/\s+/g, '')) < 0) sub.push(row.dims);
    if (row.grain && !/^pair$/i.test(row.grain)) sub.push(row.grain);
    // '(on the fold)' printed as a note is already the pill and the hint.
    if (row.note && !(row.onFold && /^(?:place\s+|cut\s+)?on\s+(?:the\s+)?fold$/i.test(row.note))) sub.push(row.note);
    if (sub.length) mid.appendChild(C.el('span', 'sw-cut-sub', sub.join(' · ')));
    // '2 mirrored = 1 pair', 'on the fold: one whole piece per cut'.
    var hint = S.cutHint(row);
    if (hint) mid.appendChild(C.el('span', 'sw-cut-hint', hint));
    C.on(mid, 'click', function () { openCutEditor(proj.id, index, function () { rerender(body); }); });

    node.appendChild(counter);
    node.appendChild(mid);
    if (row.onFold) node.appendChild(C.el('span', 'pill sw-fold', 'on fold'));
    return node;
  }

  /** The stepper for a big row: −10 −1 +1 +10, none / all. Saved once, on Save. */
  function openCutCount(projectId, index, rerender, body) {
    var row = dataOf(Store.project(projectId)).cutting[index];
    if (!row) return;
    var v = row.cutCount;
    var readout = null, fill = null;
    function show() {
      readout.textContent = v + ' of ' + row.qty + ' cut';
      fill.style.width = Math.round((v / row.qty) * 100) + '%';
    }
    function bump(dlt) { v = Math.max(0, Math.min(row.qty, v + dlt)); C.fb('tap'); show(); }
    C.openSheet({
      title: row.piece,
      cls: 'sheet-sewing',
      build: function (b) {
        readout = C.el('p', 'sw-cutcount-readout');
        readout.setAttribute('aria-live', 'polite');
        b.appendChild(readout);
        var bar = C.el('div', 'bar');
        fill = C.el('div', 'bar-fill');
        bar.appendChild(fill);
        b.appendChild(bar);
        var hint = S.cutHint(row);
        if (hint) b.appendChild(C.el('p', 'field-hint', hint));
        var pad = C.el('div', 'sw-cutcount-pad');
        [[-10, '−10'], [-1, '−1'], [1, '+1'], [10, '+10']].forEach(function (k) {
          var bt = C.button('btn ghost sw-cutcount-btn', k[1], (k[0] > 0 ? 'Add ' : 'Take off ') + Math.abs(k[0]));
          C.on(bt, 'click', function () { bump(k[0]); });
          pad.appendChild(bt);
        });
        b.appendChild(pad);
        var ends = C.el('div', 'sw-cutcount-ends');
        var none = C.button('btn ghost', 'None cut');
        var all = C.button('btn ghost', 'All ' + row.qty + ' cut');
        C.on(none, 'click', function () { v = 0; C.fb('tap'); show(); });
        C.on(all, 'click', function () { v = row.qty; C.fb('tap'); show(); });
        ends.appendChild(none);
        ends.appendChild(all);
        b.appendChild(ends);
        show();
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (a) { a.close(); } },
        { text: 'Save', cls: 'btn primary', onClick: function (a) { a.close(); setCut(projectId, index, v, rerender, body); } }
      ]
    });
  }

  function afterCut(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    paint(p);
    if (d.cutting.length && cutDone(d) >= d.cutting.length) {
      C.celebrate('piece');
      C.toast('Everything’s cut ✂️');
    }
  }

  function openCutEditor(projectId, index, after) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    var row = index === null ? { piece: '', qty: 1, material: 'main', onFold: false, grain: '', note: '', dims: '' } : d.cutting[index];
    if (!row) return;

    var name = C.textInput(row.piece, 'Front bodice');
    var qty = C.stepper(row.qty, 1, 99, 'quantity');
    var dims = C.textInput(row.dims, '14 × 16 in');
    var mat = C.segmented(MATERIAL_ORDER.map(function (m) { return { id: m, label: MATERIAL_NAMES[m] }; }), row.material);
    var fold = { value: row.onFold };
    var foldRow = C.switchRow('Cut on the fold', null, row.onFold, function (v) { fold.value = v; });

    var footer = [
      { text: 'Cancel', cls: 'btn ghost', onClick: function (a) { a.close(); } },
      {
        text: 'Save', cls: 'btn primary',
        onClick: function (a) {
          var piece = name.value.replace(/^\s+|\s+$/g, '');
          if (!piece) { C.toast('Give the piece a name'); return; }
          edit(projectId, function (dd) {
            var target = index === null ? null : dd.cutting[index];
            if (!target) {
              target = {
                id: 'sc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                piece: piece, qty: qty.get(), cutCount: 0, material: mat.get(),
                onFold: fold.value, grain: '', note: '', dims: dims.value
              };
              dd.cutting.push(target);
              return;
            }
            target.piece = piece;
            target.qty = qty.get();
            if (target.cutCount > target.qty) target.cutCount = target.qty;
            target.material = mat.get();
            target.onFold = fold.value;
            target.dims = dims.value;
          });
          a.close();
          if (after) after();
          paint(Store.project(projectId));
        }
      }
    ];
    if (index !== null) {
      footer.unshift({
        text: 'Delete', cls: 'btn danger',
        onClick: function (a) {
          edit(projectId, function (dd) { dd.cutting.splice(index, 1); });
          a.close();
          if (after) after();
          paint(Store.project(projectId));
        }
      });
    }

    C.openSheet({
      title: index === null ? 'Add a piece' : 'Edit piece',
      build: function (b) {
        b.appendChild(C.field('Piece', name));
        b.appendChild(C.field('How many', qty.node));
        b.appendChild(C.field('Size', dims, 'Optional — bag patterns give the rectangle.'));
        b.appendChild(C.field('Fabric', mat.node));
        b.appendChild(foldRow);
      },
      footer: footer
    });
  }

  // --- Notions -----------------------------------------------------------

  function openNotionsSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var api = C.openSheet({
      title: 'Notions',
      cls: 'sheet-sewing',
      build: function (body) { renderNotions(body); }
    });

    function renderNotions(body) {
      C.clear(body);
      var proj = Store.project(projectId);
      if (!proj) { api.close(); return; }
      var d = dataOf(proj);
      body.appendChild(sheetHeadLine(
        d.notions.length ? notionsDone(d) + ' of ' + d.notions.length + ' ready' : 'Nothing on the list yet.'
      ));

      var list = C.el('div', 'list');
      for (var i = 0; i < d.notions.length; i++) list.appendChild(notionRow(proj, d.notions[i], i, body, renderNotions));
      body.appendChild(list);

      var input = C.textInput('', 'Invisible zip, 40 cm');
      var addWrap = C.el('div', 'sw-add-row');
      var add = C.button('btn ghost', '＋ Add');
      function doAdd() {
        var text = input.value.replace(/^\s+|\s+$/g, '');
        if (!text) return;
        edit(projectId, function (dd) {
          dd.notions.push({
            id: 'sn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            text: text, qty: S.notionQty(text), kind: S.notionKind(text), have: false
          });
        });
        input.value = '';
        renderNotions(body);
        paint(Store.project(projectId));
      }
      C.on(add, 'click', doAdd);
      C.on(input, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      addWrap.appendChild(input);
      addWrap.appendChild(add);
      body.appendChild(addWrap);

      // What goes on the shopping list (05 #5, Wave F): the fabric for your
      // size first, then the notions not ticked off, then thread.
      body.appendChild(C.el('div', 'sw-group-head', 'Shopping list'));
      var inc = shopInclude();
      var togs = C.el('div', 'sw-shop-toggles');
      [['fabric', 'Fabric'], ['notions', 'Notions'], ['thread', 'Thread']].forEach(function (t) {
        var on = inc[t[0]] !== false;
        var pill = C.button('pill sw-size-chip sw-shop-toggle' + (on ? ' on' : ''), t[1],
          (on ? 'Leave ' : 'Put ') + t[1].toLowerCase() + (on ? ' off' : ' on') + ' the shopping list');
        pill.setAttribute('aria-pressed', on ? 'true' : 'false');
        pill.setAttribute('data-focus-key', 'shop-' + t[0]);
        C.on(pill, 'click', function () {
          var next = shopInclude();
          next[t[0]] = !on;
          setSetting('shopping', next);
          C.fb('tap');
          if (C.preserveFocus) C.preserveFocus(function () { renderNotions(body); });
          else renderNotions(body);
        });
        togs.appendChild(pill);
      });
      body.appendChild(togs);

      var lines = S.shoppingList(d, inc);
      var copy = C.button('btn primary block', '📋 Copy shopping list');
      C.on(copy, 'click', function () { copyShoppingList(projectId); });
      copy.disabled = !lines.length;
      body.appendChild(copy);
      var bits = [];
      if (inc.fabric !== false && d.fabric.length) {
        bits.push(d.size.chosen ? 'the fabric for size ' + d.size.chosen
          : (d.size.sizeLabels.length ? 'the fabric per size (choose your size to list only yours)' : 'the fabric'));
      }
      if (inc.notions !== false) bits.push('everything you have not ticked off');
      if (inc.thread !== false && lines.indexOf('Thread to match') >= 0) bits.push('thread to match');
      body.appendChild(C.el('p', 'field-hint', lines.length
        ? 'Copies ' + plural(lines.length, 'line') + ' — ' + listJoin(bits) + '.'
        : 'Nothing to copy — everything is ticked off or left out.'));
      if (lines.length) {
        var pv = document.createElement('details');
        pv.className = 'sw-shop-preview';
        var ps0 = document.createElement('summary');
        ps0.textContent = 'Preview';
        pv.appendChild(ps0);
        var ul = C.el('ul', 'sw-shop-lines');
        lines.forEach(function (l) { ul.appendChild(C.el('li', null, l)); });
        pv.appendChild(ul);
        body.appendChild(pv);
      }
    }
  }

  function shopInclude() {
    var s = settings().shopping;
    return (s && typeof s === 'object') ? { fabric: s.fabric !== false, notions: s.notions !== false, thread: s.thread !== false }
      : { fabric: true, notions: true, thread: true };
  }

  function notionRow(proj, row, index, body, rerender) {
    var node = C.el('div', 'list-item' + (row.have ? ' done' : ''));
    var check = C.button('check', '✓', (row.have ? 'Mark ' : 'Mark ') + row.text + (row.have ? ' not bought' : ' bought'));
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', row.have ? 'true' : 'false');
    C.on(check, 'click', function () {
      edit(proj.id, function (dd) { if (dd.notions[index]) dd.notions[index].have = !dd.notions[index].have; });
      C.fb('tap');
      rerender(body);
      paint(Store.project(proj.id));
    });
    var text = C.el('span', 'item-text', row.text);
    var del = C.button('item-del', '✕', 'Remove ' + row.text);
    C.on(del, 'click', function () {
      edit(proj.id, function (dd) { dd.notions.splice(index, 1); });
      rerender(body);
      paint(Store.project(proj.id));
    });
    node.appendChild(check);
    node.appendChild(text);
    if (row.kind !== 'notion') node.appendChild(C.el('span', 'pill sw-kind', row.kind));
    node.appendChild(del);
    return node;
  }

  function copyShoppingList(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    var lines = S.shoppingList(d, shopInclude()).map(function (l) { return '• ' + l; });
    if (!lines.length) { C.toast('You already have everything on this list'); return; }
    var title = (d.meta.patternName || p.name) + ' — still to buy';
    var text = title + '\n' + lines.join('\n');

    function shared() { C.toast('Shopping list copied'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(shared, function () { shareFallback(text, title); });
      return;
    }
    shareFallback(text, title);
  }

  function shareFallback(text, title) {
    if (navigator.share) {
      navigator.share({ title: title, text: text }).then(function () {
        C.toast('Shopping list shared');
      }, function () { /* the user cancelled */ });
      return;
    }
    C.openSheet({
      title: 'Shopping list',
      build: function (b) {
        var ta = C.textArea(text, 'sw-copy-area');
        ta.readOnly = true;
        b.appendChild(C.el('p', 'muted', 'Copying is not available here — select this and copy it by hand.'));
        b.appendChild(ta);
        window.setTimeout(function () { ta.focus(); ta.select(); }, 60);
      },
      footer: [{ text: 'Done', cls: 'btn primary', onClick: function (a) { a.close(); } }]
    });
  }

  // --- Seam allowance ----------------------------------------------------

  function openSeamSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    C.openSheet({
      title: 'Seam allowance',
      build: function (b) {
        if (!d.seamAllowance) {
          b.appendChild(C.el('p', 'muted', 'The pattern did not say. Check the first page of the instructions.'));
          return;
        }
        // On a step that mentions a part the exception names, say so first
        // (05 #15, Wave F) — as a reminder to check, not as a rule.
        var cur = d.steps.length ? d.steps[Math.min(d.currentStep, d.steps.length - 1)] : null;
        var rem = cur ? S.saReminder(d, cur.text) : null;
        if (rem) {
          var rc = C.el('div', 'card sw-sa-reminder');
          rc.appendChild(C.el('strong', null, 'This step mentions the ' + rem.part + '.'));
          rc.appendChild(C.el('p', null, 'The pattern sews those at ' +
            (rem.mm >= 10 ? (rem.mm / 10) + ' cm' : rem.mm + ' mm') + (rem.inches ? ' (' + rem.inches + '")' : '') +
            ' — check whether this seam is one of them.'));
          b.appendChild(rc);
        }
        b.appendChild(C.el('p', 'sw-sa-big', saLabel(d).replace(/^Seam allowance /, '')));
        if (d.seamAllowance.text) b.appendChild(C.el('p', 'muted', d.seamAllowance.text));
        if (d.seamAllowance.included !== null) {
          b.appendChild(C.el('p', 'muted', d.seamAllowance.included
            ? 'Seam allowances are included in the pieces.'
            : 'Seam allowances are not included — add them as you cut.'));
        }
        var ex = d.seamAllowance.exceptions || [];
        if (ex.length) {
          b.appendChild(C.el('div', 'sw-group-head', 'Except'));
          var list = C.el('div', 'list');
          for (var i = 0; i < ex.length; i++) {
            var row = C.el('div', 'list-item');
            row.appendChild(C.el('span', 'item-text', ex[i].text));
            if (typeof ex[i].mm === 'number') row.appendChild(C.el('span', 'chip', ex[i].mm + ' mm'));
            list.appendChild(row);
          }
          b.appendChild(list);
        }
      },
      footer: [{ text: 'Done', cls: 'btn primary', onClick: function (a) { a.close(); } }]
    });
  }

  // --- Size and measurements ---------------------------------------------

  function openSizeSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    // Set before openSheet: build() runs at once, and an unset `which` drew a chart
    // with both body and finished rows as an empty table (sew-audit).
    var which = 'body';
    var api = C.openSheet({
      title: 'Size & alterations',
      cls: 'sheet-sewing',
      build: function (body) { renderSize(body); }
    });

    function rerender(body) {
      if (C.preserveFocus) C.preserveFocus(function () { renderSize(body); });
      else renderSize(body);
    }

    function renderSize(body) {
      C.clear(body);
      var proj = Store.project(projectId);
      if (!proj) { api.close(); return; }
      var d = dataOf(proj);
      var chart = chartOf(d);
      if (chart && (!chart.labels || !chart.labels.length || !chart.rows || !chart.rows.length)) chart = null;
      if (!chart) { renderLegacySize(body, proj, d); return; }
      var units = unitsOf(d, chart);
      var unit = lenUnit(units);
      var labels = chart.labels;

      // --- the project's unit switch (the pattern's own units by default) ---
      var unitSeg = C.segmented([{ id: 'metric', label: 'cm' }, { id: 'imperial', label: 'inches' }], units, function (v) {
        edit(projectId, function (dd) {
          if (!dd.fabricPrefs) dd.fabricPrefs = {};
          dd.fabricPrefs.unit = v;
        }, 'size');
        rerender(body);
      });
      unitSeg.node.classList.add('sw-unit-seg');
      body.appendChild(C.field('Measure in', unitSeg.node,
        chart.units === 'dual' ? 'The pattern prints both.' : (chart.units ? 'The pattern prints ' + (chart.units === 'in' ? 'inches' : 'cm') + '.' : '')));

      // --- my measurements (the shared profile, every project) ---
      body.appendChild(C.el('div', 'sw-group-head', 'My measurements'));
      body.appendChild(C.el('p', 'field-hint', 'Kept on this device for every project. Type yours to get a size suggestion.'));
      var grid = C.el('div', 'sw-meas-grid');
      measureLabels(d, chart).forEach(function (label) {
        var v = myMeasure(label, unit);
        var input = C.textInput(v === null ? '' : String(v), unit === 'in' ? '38' : '96');
        input.setAttribute('inputmode', 'decimal');
        input.setAttribute('aria-label', 'My ' + label.toLowerCase() + ' in ' + (unit === 'in' ? 'inches' : 'centimetres'));
        input.className += ' sw-meas-input';
        C.on(input, 'change', function () {
          setMyMeasure(label, input.value.replace(/^\s+|\s+$/g, ''), unit);
          emitChange(projectId, 'size');
          rerender(body);
        });
        var cell = C.el('label', 'sw-meas');
        cell.appendChild(C.el('span', 'sw-meas-label', label));
        var line = C.el('span', 'sw-meas-line');
        line.appendChild(input);
        line.appendChild(C.el('span', 'sw-meas-unit', unit === 'in' ? 'in' : 'cm'));
        cell.appendChild(line);
        grid.appendChild(cell);
      });
      body.appendChild(grid);

      // --- the advice: a suggestion, labelled, never chosen for you ---
      var adv = adviceFor(d, chart, units);
      var rule = adv ? adv.rule : (S.sizeRule ? S.sizeRule(d.sourceText || '') : null);
      if (adv && adv.suggestion) {
        var card = C.el('section', 'card sw-advice');
        card.setAttribute('aria-label', 'Size suggestion');
        var head = C.el('div', 'sw-advice-head');
        head.appendChild(C.el('span', 'sw-advice-tag', 'Suggestion'));
        var sug = adv.suggestion;
        var title = 'Size ' + sug.size;
        if (sug.blend && sug.blend.length) {
          title += ', with ' + sug.blend.map(function (b) { return b.size + ' at the ' + b.label.toLowerCase(); }).join(' and ');
        }
        head.appendChild(C.el('span', 'sw-advice-size', title));
        card.appendChild(head);
        var why = C.el('ul', 'sw-advice-why');
        adv.rows.forEach(function (r) {
          var li = C.el('li', 'sw-advice-row sw-at-' + r.at, r.why);
          why.appendChild(li);
        });
        card.appendChild(why);
        if (sug.blend && sug.blend.length) {
          card.appendChild(C.el('p', 'field-hint', 'Between sizes: cut ' + sug.size + ' and grade to ' +
            sug.blend.map(function (b) { return b.size + ' at the ' + b.label.toLowerCase(); }).join(' and ') +
            '. This is a suggestion; the pattern pieces decide.'));
        }
        if (adv.ease && adv.ease.length) {
          card.appendChild(C.el('p', 'sw-advice-ease', 'Ease at ' + sug.size + ': ' + adv.ease.map(function (e) {
            var v = units === 'imperial' ? Math.round(e.mm / 25.4 * 4) / 4 + '"' : Math.round(e.mm / 10 * 10) / 10 + ' cm';
            return e.label + ' ' + (e.mm > 0 ? '+' : '') + v;
          }).join(' · ') + (adv.ease.some(function (e) { return e.negative; })
            ? ' (less than you: this is cut to stretch)' : '')));
        }
        if (d.size.chosen === sug.size) {
          card.appendChild(C.el('p', 'sw-advice-using', '✓ You are using size ' + sug.size));
        } else {
          var use = C.button('btn primary block sw-advice-use', 'Use ' + sug.size, 'Use size ' + sug.size + ' for this project');
          C.on(use, 'click', function () {
            chooseSize(projectId, sug.size);
            rerender(body);
          });
          card.appendChild(use);
        }
        body.appendChild(card);
      } else if (adv && !adv.suggestion && adv.why) {
        body.appendChild(C.el('p', 'muted sw-advice-none', adv.why));
      }
      if (rule && rule.text) {
        var q = C.el('blockquote', 'sw-rule');
        q.appendChild(C.el('span', 'sw-rule-lead', 'The pattern says: '));
        q.appendChild(C.el('span', 'sw-rule-text', '“' + rule.text + '”'));
        // sew-core: a second rule ("only slightly different → the closest size") is its own quote.
        if (rule.slightlyText) q.appendChild(C.el('span', 'sw-rule-text sw-rule-slightly', ' “' + rule.slightlyText + '”'));
        if (typeof rule.page === 'number') {
          var pg = C.button('chip sw-rule-page', 'page ' + rule.page, 'Show page ' + rule.page);
          if (!pageRow(d, rule.page)) { pg.disabled = true; pg.classList.add('sw-page-plain'); }
          C.on(pg, 'click', function () { openPageViewer(projectId, rule.page); });
          q.appendChild(pg);
        }
        body.appendChild(q);
      }

      // --- your size: the chips (the sewist's own choice) ---
      var chips = C.el('div', 'sw-size-chips');
      labels.forEach(function (lab) {
        var isSug = adv && adv.suggestion && adv.suggestion.size === lab;
        var chip = C.button('pill sw-size-chip' + (d.size.chosen === lab ? ' on' : '') + (isSug ? ' sw-suggested' : ''), lab,
          'Choose size ' + lab + (isSug ? ' (suggested)' : ''));
        chip.setAttribute('aria-pressed', d.size.chosen === lab ? 'true' : 'false');
        C.on(chip, 'click', function () {
          chooseSize(projectId, d.size.chosen === lab ? '' : lab);
          rerender(body);
        });
        chips.appendChild(chip);
      });
      body.appendChild(C.field('Your size', chips, d.size.chosen ? '' : 'Pick one, or type your measurements above for a suggestion.'));

      // --- the chart, as read, with its own check ---
      var hasBody = chart.rows.some(function (r) { return r.kind === 'body'; });
      var hasFin = chart.rows.some(function (r) { return r.kind === 'finished'; });
      if (hasBody && hasFin) {
        var seg = C.segmented([{ id: 'body', label: 'Body' }, { id: 'finished', label: 'Finished' }], which, function (v) {
          which = v;
          rerender(body);
        });
        body.appendChild(seg.node);
      }
      var want = hasBody && hasFin ? which : (hasBody ? 'body' : 'finished');
      body.appendChild(chartTable(chart, chart.rows.filter(function (r) { return r.kind === want; }), d.size.chosen, units));
      if (chart.check && C.check && C.check.line) {
        body.appendChild(C.check.line(chart.check, {
          onOpen: function () {
            C.check.open(chart.check, { title: 'The size chart as read', onPage: function (pn) { openPageViewer(projectId, pn); } });
          }
        }));
      }

      // --- every per-size number, for your size ---
      if (d.size.chosen) body.appendChild(resolvedBlock(proj, d));

      appendAlterations(body, d);
    }

    /** The pre-wave-K sheet, for a pattern whose chart could not be read as a chart. */
    function renderLegacySize(body, proj, d) {
      // size chips
      if (d.size.sizeLabels.length) {
        var chips = C.el('div', 'sw-size-chips');
        d.size.sizeLabels.forEach(function (lab) {
          var chip = C.button('pill sw-size-chip' + (d.size.chosen === lab ? ' on' : ''), lab, 'Choose size ' + lab);
          chip.setAttribute('aria-pressed', d.size.chosen === lab ? 'true' : 'false');
          C.on(chip, 'click', function () {
            edit(projectId, function (dd) { dd.size.chosen = dd.size.chosen === lab ? '' : lab; });
            renderSize(body);
            paint(Store.project(projectId));
          });
          chips.appendChild(chip);
        });
        body.appendChild(C.field('Your size', chips));
      } else {
        var free = C.textInput(d.size.chosen, 'M, 12, 38…');
        C.on(free, 'change', function () {
          edit(projectId, function (dd) { dd.size.chosen = free.value.replace(/^\s+|\s+$/g, ''); });
          paint(Store.project(projectId));
        });
        body.appendChild(C.field('Your size', free, 'No size chart was found, so type it in.'));
      }

      // body / finished toggle + table
      var hasBody = d.measurements.body.length > 0;
      var hasFinished = d.measurements.finished.length > 0;
      if (hasBody || hasFinished) {
        if (hasBody && hasFinished) {
          var seg = C.segmented([{ id: 'body', label: 'Body' }, { id: 'finished', label: 'Finished' }], which, function (v) {
            which = v;
            renderSize(body);
          });
          body.appendChild(seg.node);
        }
        var rows = (which === 'finished' && hasFinished) ? d.measurements.finished : (hasBody ? d.measurements.body : d.measurements.finished);
        body.appendChild(measureTable(d.size.sizeLabels, rows, d.size.chosen));

        if (hasBody && hasFinished && d.size.chosen) {
          var ease = easeRows(d, d.size.chosen);
          if (ease.length) {
            body.appendChild(C.el('div', 'sw-group-head', 'Ease at size ' + d.size.chosen));
            var el2 = C.el('div', 'list');
            ease.forEach(function (e) {
              var r = C.el('div', 'list-item');
              r.appendChild(C.el('span', 'item-text', e.label));
              r.appendChild(C.el('span', 'chip', (e.diff > 0 ? '+' : '') + e.diff));
              el2.appendChild(r);
            });
            body.appendChild(el2);
          }
        }
      }

      // my measurements (shared across projects, via craft settings)
      body.appendChild(C.el('div', 'sw-group-head', 'My measurements'));
      body.appendChild(C.el('p', 'field-hint', 'Stored on this device and reused by every sewing project.'));
      var mine = settings().measurements;
      if (!mine || typeof mine !== 'object') mine = {};
      var labels = [];
      var seen = {};
      (d.measurements.body.length ? d.measurements.body : d.measurements.finished).forEach(function (r) {
        if (!seen[r.label]) { seen[r.label] = 1; labels.push(r.label); }
      });
      ['Bust', 'Waist', 'Hip', 'Height'].forEach(function (l) { if (!seen[l]) { seen[l] = 1; labels.push(l); } });
      var lu = lenUnit(unitsOf(d, null));
      labels.forEach(function (label) {
        var have = myMeasure(label, lu);
        var input = C.textInput(have === null ? (mine[label] || '') : String(have), lu === 'in' ? '38' : '96');
        input.setAttribute('inputmode', 'decimal');
        input.setAttribute('aria-label', 'My ' + label.toLowerCase() + ' in ' + (lu === 'in' ? 'inches' : 'centimetres'));
        C.on(input, 'change', function () {
          setMyMeasure(label, input.value.replace(/^\s+|\s+$/g, ''), lu);
          emitChange(projectId, 'size');
        });
        body.appendChild(C.field(label + (lu === 'in' ? ' (in)' : ' (cm)'), input));
      });

      if (d.size.chosen) body.appendChild(resolvedBlock(proj, d));
      appendAlterations(body, d);
    }

    function appendAlterations(body, d) {
      var alt = C.textArea(d.size.alterations, 'sw-alt', 'FBA 2.5 cm, lengthened bodice 3 cm, sway back 1 cm…');
      alt.setAttribute('aria-label', 'Alterations');
      C.on(alt, 'change', function () {
        edit(projectId, function (dd) { dd.size.alterations = alt.value; }, 'size');
        paint(Store.project(projectId));
      });
      body.appendChild(C.field('Alterations', alt, 'What you changed, so next time you remember.'));
    }
  }

  /** The size sheet's "Use 42" and chips: one undo step. */
  function chooseSize(projectId, size) {
    edit(projectId, function (dd) { dd.size.chosen = size || ''; }, 'size');
    var pr = Store.project(projectId);
    paint(pr);
    refreshWork();
    if (size) C.announce('Size ' + size + ' chosen');
  }

  /** The size chart as read: the chosen column lit, a cell the reader doubts shown as "?". */
  function chartTable(chart, rows, chosen, units) {
    var wrap = C.el('div', 'sw-table-wrap');
    var table = C.el('table', 'sw-table');
    var thead = C.el('thead');
    var hr = C.el('tr');
    hr.appendChild(C.el('th', null, ''));
    chart.labels.forEach(function (l) { hr.appendChild(C.el('th', l === chosen ? 'on' : null, l)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = C.el('tbody');
    rows.forEach(function (r) {
      var tr = C.el('tr');
      tr.appendChild(C.el('th', null, r.label));
      for (var i = 0; i < chart.labels.length; i++) {
        var c = r.cells[i] || null;
        var text = '—', unsure = false;
        if (c) {
          if (c.ok === false || (c.mm === null && c.text)) { unsure = true; text = (c.text || '') + ' ?'; }
          else if (typeof c.mm === 'number') {
            text = units === 'imperial'
              ? (c.inch !== null && c.inch !== undefined ? String(c.inch) : '≈' + Math.round(c.mm / 25.4 * 4) / 4)
              : (c.cm !== null && c.cm !== undefined ? String(c.cm) : '≈' + Math.round(c.mm) / 10);
          } else if (c.text) text = c.text;
        }
        var td = C.el('td', (chart.labels[i] === chosen ? 'on' : '') + (unsure ? ' sw-cell-unsure' : ''), text);
        if (unsure) {
          td.title = (c && c.why) || 'This cell could not be read for certain: check the page.';
          td.setAttribute('aria-label', chart.labels[i] + ': ' + (c && c.text ? c.text : 'unreadable') + ', not certain');
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    wrap.appendChild(C.el('p', 'field-hint sw-table-unit', (units === 'imperial' ? 'Inches' : 'Centimetres') +
      '. ≈ = converted by the app; ? = could not be read for certain, check the page.'));
    return wrap;
  }

  /** "At size 42": every per-size number the booklet prints, once. Unsure ones say so. */
  function resolvedBlock(proj, d) {
    var box = C.el('section', 'sw-resolved');
    var res = resolvedFor(proj, d);
    box.appendChild(C.el('div', 'sw-group-head', 'At size ' + d.size.chosen));
    if (!res) { box.appendChild(C.el('p', 'muted', 'Nothing in the pattern changes with the size.')); return box; }
    var WHERE = { fabric: 'Fabric', elastic: 'Elastic', finished: 'Finished', body: 'Body', step: 'In the steps', notion: 'Notions', cutting: 'Cutting' };
    // A chart printed under "SIZE CHART (cm)" gives bare numbers: say the unit (never a bare 104).
    var ch = chartOf(d);
    var chartUnit = ch && (ch.units === 'cm' || ch.units === 'in') ? ch.units : '';
    function withUnit(v, it) {
      v = String(v);
      if (chartUnit && (it.where === 'body' || it.where === 'finished') && /^\d+(?:[.,]\d+)?$/.test(v)) {
        return chartUnit === 'in' ? v + '"' : v + ' cm';
      }
      return v;
    }
    var list = C.el('div', 'list');
    res.items.forEach(function (it) {
      var row = C.el('div', 'list-item sw-res-row' + (it.check ? ' sw-res-unsure' : ''));
      var t = C.el('span', 'item-text');
      var what = String(it.what || '');
      if (/^[a-z]/.test(what)) what = '…' + what;
      t.appendChild(C.el('span', 'sw-res-what', (WHERE[it.where] ? WHERE[it.where] + ' · ' : '') + what +
        (it.step ? ' (step ' + it.step + ')' : '')));
      if (it.check) t.appendChild(C.el('span', 'sw-res-check', '? ' + it.check));
      row.appendChild(t);
      row.appendChild(C.el('span', 'chip sw-res-val' + (it.check ? ' sw-cell-unsure' : ''), (it.check ? '? ' : '') + withUnit(it.value, it)));
      list.appendChild(row);
    });
    if (res.items.length) box.appendChild(list);
    if (res.unresolved.length) {
      var un = C.el('div', 'sw-res-unresolved');
      un.appendChild(C.el('p', 'field-hint', 'Could not be read for size ' + d.size.chosen + ':'));
      res.unresolved.slice(0, 12).forEach(function (u) {
        un.appendChild(C.el('p', 'muted sw-res-un', u.what + ': ' + u.why + (typeof u.page === 'number' ? ' (page ' + u.page + ')' : '')));
      });
      box.appendChild(un);
    }
    if (!res.items.length && !res.unresolved.length) box.appendChild(C.el('p', 'muted', 'Nothing in the pattern changes with the size.'));
    return box;
  }

  function measureTable(labels, rows, chosen) {
    var wrap = C.el('div', 'sw-table-wrap');
    var table = C.el('table', 'sw-table');
    var thead = C.el('thead');
    var hr = C.el('tr');
    hr.appendChild(C.el('th', null, ''));
    labels.forEach(function (l) {
      var th = C.el('th', l === chosen ? 'on' : null, l);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = C.el('tbody');
    rows.forEach(function (r) {
      var tr = C.el('tr');
      tr.appendChild(C.el('th', null, r.label));
      for (var i = 0; i < labels.length; i++) {
        tr.appendChild(C.el('td', labels[i] === chosen ? 'on' : null, r.values[i] || '—'));
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function easeRows(d, chosen) {
    var idx = d.size.sizeLabels.indexOf(chosen);
    if (idx < 0) return [];
    var out = [];
    d.measurements.body.forEach(function (b) {
      var f = null;
      d.measurements.finished.forEach(function (x) { if (x.label === b.label) f = x; });
      if (!f) return;
      var bv = parseFloat(String(b.values[idx] || '').replace(/[^\d.]/g, ''));
      var fv = parseFloat(String(f.values[idx] || '').replace(/[^\d.]/g, ''));
      if (!isFinite(bv) || !isFinite(fv)) return;
      out.push({ label: b.label, diff: Math.round((fv - bv) * 10) / 10 });
    });
    return out;
  }

  // --- Fabric ------------------------------------------------------------

  function openFabricSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    C.openSheet({
      title: 'Fabric',
      cls: 'sheet-sewing',
      build: function (b) { fabricOwnParts(projectId, b, {}); },
      footer: [{ text: 'Done', cls: 'btn primary', onClick: function (a) { a.close(); } }]
    });
  }

  /**
   * What the old Fabric sheet showed, reused by sew-extras' "Fabric and shopping list"
   * (the one fabric item in the menu since sew-audit): every row as the pattern prints it
   * (all sizes, size groups, unread lines), the nap sentences and "What I actually used".
   * opts.embedded: the extras sheet already says what to buy for your size, so the rows go in
   * a closed "As the pattern prints it" group and the "What you need" card is left out.
   */
  function fabricOwnParts(projectId, host, opts) {
    opts = opts || {};
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    var b = host;
    if (opts.embedded && d.fabric.length) {
      var det = document.createElement('details');
      det.className = 'sw-fabric-printed';
      var sm = document.createElement('summary');
      sm.textContent = 'As the pattern prints it (' + plural(d.fabric.length, 'row') + ')';
      det.appendChild(sm);
      host.appendChild(det);
      b = det;
    }
    (function () {
        if (!d.fabric.length) {
          // Embedded, the extras sheet has already said so ("lists no fabric amounts the app could read").
          if (!opts.embedded) b.appendChild(C.el('p', 'muted', 'No fabric requirements were found in the pattern.'));
        } else {
          // The one thing a sewist standing in the fabric shop wants: how much
          // of each bolt width, for THEIR size. Booklets print this per size
          // GROUP ('36-38-40  42-44'), so the parser expands it per size first.
          var mine = [];
          if (!opts.embedded) {
            try { mine = S.fabricForSize(d.fabric, d.size.sizeLabels, d.size.chosen) || []; } catch (e) { mine = []; }
          }
          if (mine.length) {
            var card0 = C.el('div', 'card sw-fabric-mine');
            card0.appendChild(C.el('div', 'sw-fabric-mine-head', 'What you need'));
            mine.forEach(function (r) {
              var line0 = C.el('div', 'sw-fabric-mine-row');
              line0.appendChild(C.el('span', 'sw-fabric-mine-size', 'Size ' + d.size.chosen));
              line0.appendChild(C.el('span', 'sw-fabric-mine-amount', r.amount));
              line0.appendChild(C.el('span', 'sw-fabric-mine-at',
                // A row printed without a bolt width ('LINING 1m / 1 yd') is
                // named, not "at this width" (HANDOFF item 5, sewing-audit).
                r.width
                  ? 'at ' + r.width + (r.name && !/^fabric$/i.test(r.name) ? ' · ' + r.name : '')
                  : (r.name || 'Fabric') + ' · any width'));
              card0.appendChild(line0);
            });
            b.appendChild(card0);
          } else if (!opts.embedded && !d.size.chosen && d.size.sizeLabels.length) {
            b.appendChild(C.el('p', 'field-hint', 'Choose your size in Size & alterations to see only the fabric you need.'));
          }

          d.fabric.forEach(function (row) {
            var card = C.el('div', 'card sw-fabric-row');
            card.appendChild(C.el('div', 'sw-fabric-name', row.name + (row.width ? ' · ' + row.width : '')));
            if (row.amounts.length && d.size.sizeLabels.length === row.amounts.length) {
              var line = C.el('div', 'sw-fabric-amounts');
              for (var i = 0; i < row.amounts.length; i++) {
                var chip = C.el('span', 'chip' + (d.size.sizeLabels[i] === d.size.chosen ? ' on' : ''),
                  d.size.sizeLabels[i] + ' ' + row.amounts[i]);
                line.appendChild(chip);
              }
              card.appendChild(line);
              if (row.grouped) {
                card.appendChild(C.el('div', 'field-hint sw-fabric-grouped',
                  'The pattern prints this per size group — sizes that share a figure show the same amount.'));
              }
            } else if (row.groupLabels && row.groupLabels.length === row.rawAmounts.length) {
              // Per size group, as printed ('Sizes A-H', Samford); the
              // booklet's size letters are not in its text, so nothing is
              // spread across sizes it never named (Wave F).
              var gline = C.el('div', 'sw-fabric-amounts');
              row.rawAmounts.forEach(function (a, gi) {
                gline.appendChild(C.el('span', 'chip', 'Sizes ' + row.groupLabels[gi] + ' · ' + a));
              });
              card.appendChild(gline);
            } else if (row.line) {
              card.appendChild(C.el('div', 'muted sw-fabric-raw', row.line));
            }
            b.appendChild(card);
          });
        }
        b = host;
        var nap = napBlock(projectId, d);
        if (nap) b.appendChild(nap);
        // SewingData has no field for this, and normalize() drops unknown keys,
        // so it lives in the project's own notes behind a small tag.
        var used = C.textArea(fabricUsedFrom(p), 'sw-alt', '2 m navy linen, 150 cm wide');
        used.setAttribute('aria-label', 'What I actually used');
        C.on(used, 'change', function () {
          var proj = Store.project(projectId);
          if (!proj) return;
          Store.updateProject(projectId, { notes: notesWithFabric(proj, used.value) });
          C.toast('Saved to the project notes');
        });
        used.setAttribute('data-focus-key', 'fabric-used');
        b.appendChild(C.field('What I actually used', used, 'Saved into the project notes.'));
    })();
  }

  var FABRIC_TAG = 'Fabric used: ';

  function fabricUsedFrom(p) {
    var notes = String(p.notes || '');
    var at = notes.indexOf(FABRIC_TAG);
    if (at < 0) return '';
    var rest = notes.slice(at + FABRIC_TAG.length);
    var end = rest.indexOf('\n\n');
    return end < 0 ? rest : rest.slice(0, end);
  }

  function notesWithFabric(p, value) {
    var notes = String(p.notes || '');
    var at = notes.indexOf(FABRIC_TAG);
    if (at < 0) return (notes ? notes + '\n\n' : '') + FABRIC_TAG + value;
    var before = notes.slice(0, at);
    var rest = notes.slice(at + FABRIC_TAG.length);
    var end = rest.indexOf('\n\n');
    var after = end < 0 ? '' : rest.slice(end);
    return before + FABRIC_TAG + value + after;
  }

  // --- Machine settings --------------------------------------------------

  var MACHINE_FIELDS = [
    ['needle', 'Needle', '80/12 universal'],
    ['thread', 'Thread', 'Gütermann Sew-All 800'],
    ['stitchLength', 'Stitch length', '2.5'],
    ['tension', 'Tension', '4'],
    ['presserFoot', 'Presser foot', 'standard']
  ];

  function openMachineSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var api = C.openSheet({
      title: 'Machine settings',
      cls: 'sheet-sewing',
      build: function (body) { renderMachine(body); }
    });

    function renderMachine(body) {
      C.clear(body);
      var proj = Store.project(projectId);
      if (!proj) { api.close(); return; }
      var d = dataOf(proj);
      var inputs = {};

      MACHINE_FIELDS.forEach(function (f) {
        var input = C.textInput(d.machine[f[0]], f[2]);
        input.setAttribute('aria-label', f[1]);
        inputs[f[0]] = input;
        C.on(input, 'change', function () {
          edit(projectId, function (dd) { dd.machine[f[0]] = input.value; });
        });
        body.appendChild(C.field(f[1], input));
      });
      var notes = C.textArea(d.machine.notes, 'sw-alt', 'Anything else worth remembering');
      notes.setAttribute('aria-label', 'Machine notes');
      C.on(notes, 'change', function () {
        edit(projectId, function (dd) { dd.machine.notes = notes.value; });
      });
      body.appendChild(C.field('Notes', notes));

      body.appendChild(C.el('div', 'sw-group-head', 'Presets'));
      var presets = settings().presets;
      if (!Array.isArray(presets)) presets = [];
      if (presets.length) {
        var list = C.el('div', 'list');
        presets.forEach(function (preset, i) {
          var row = C.el('div', 'list-item');
          var load = C.button('item-text sw-preset', preset.name, 'Load the ' + preset.name + ' preset');
          C.on(load, 'click', function () {
            edit(projectId, function (dd) {
              MACHINE_FIELDS.forEach(function (f) { dd.machine[f[0]] = String(preset[f[0]] || ''); });
            });
            C.toast('Loaded “' + preset.name + '”');
            renderMachine(body);
          });
          var del = C.button('item-del', '✕', 'Delete the ' + preset.name + ' preset');
          C.on(del, 'click', function () {
            var next = presets.slice();
            next.splice(i, 1);
            setSetting('presets', next);
            renderMachine(body);
          });
          row.appendChild(load);
          row.appendChild(del);
          list.appendChild(row);
        });
        body.appendChild(list);
      } else {
        body.appendChild(C.el('p', 'field-hint', 'Save these settings so you can load them next time you sew the same fabric.'));
      }

      var save = C.button('btn ghost block', '＋ Save these as a preset');
      C.on(save, 'click', function () {
        var nameInput = C.textInput('', 'Knit jersey');
        C.openSheet({
          title: 'Name the preset',
          build: function (b2) { b2.appendChild(C.field('Name', nameInput)); window.setTimeout(function () { nameInput.focus(); }, 60); },
          footer: [
            { text: 'Cancel', cls: 'btn ghost', onClick: function (a) { a.close(); } },
            {
              text: 'Save', cls: 'btn primary',
              onClick: function (a) {
                var nm = nameInput.value.replace(/^\s+|\s+$/g, '');
                if (!nm) { a.close(); return; }
                var bag = settings().presets;
                if (!Array.isArray(bag)) bag = [];
                var preset = { id: 'sp' + Date.now().toString(36), name: nm };
                MACHINE_FIELDS.forEach(function (f) { preset[f[0]] = inputs[f[0]].value; });
                bag = bag.slice();
                bag.push(preset);
                setSetting('presets', bag);
                a.close();
                renderMachine(body);
                C.toast('Preset saved');
              }
            }
          ]
        });
      });
      body.appendChild(save);
    }
  }

  /* ================================================================== *
   * 4b. Page images: the page viewer and the pages sheet
   *
   * The booklet's diagram IS the instruction for half the steps (research
   * §A.3.4), so an opt-in import renders every page to a JPEG in BlobStore
   * and the step card grows a chip that opens it. The images are a cache:
   * the text lives in localStorage, the blobs may be evicted, and nothing
   * here ever assumes a page is still there.
   * ================================================================== */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgNode(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, String(attrs[k]));
      }
    }
    return n;
  }

  var STORED_HERE = 'Pages are saved with the project on this device and go into a .thready backup (Back up now).';

  /**
   * Rasterise the PDF's pages into BlobStore, one at a time so a 40-page
   * booklet never blocks the main thread for long. Resolves with the rows for
   * `craftData.pages` plus the total byte count (used for the toast).
   */
  /**
   * The render order: the pages the steps and the cutting layouts point at
   * first, then the rest in order, so "Stop — keep the pages so far" keeps
   * the diagrams (05 #10, Wave F). Only the first MAX_PAGES are ever kept.
   */
  function pageOrder(numPages, priority) {
    var total = Math.min(numPages || 0, MAX_PAGES);
    var order = [], seen = {};
    (priority || []).forEach(function (n) {
      if (typeof n === 'number' && n >= 1 && n <= total && !seen[n]) { seen[n] = 1; order.push(n); }
    });
    for (var n = 1; n <= total; n++) if (!seen[n]) order.push(n);
    return order;
  }

  function renderPageImages(projectId, handle, onProgress, isCancelled, priority) {
    var total = Math.min((handle && handle.numPages) || 0, MAX_PAGES);
    if (!total || !blobsAvailable() || typeof handle.renderPage !== 'function') {
      return Promise.resolve({ pages: [], bytes: 0, total: 0 });
    }
    var order = pageOrder(handle.numPages, priority);
    var pages = [];
    var bytes = 0;
    // A re-render replaces what was there, so clear the old blobs first.
    var chain = window.BlobStore.deletePrefix(pagePrefix(projectId)).then(null, function () { /* ignore */ });

    function step(n, k) {
      return function () {
        if (isCancelled && isCancelled()) return null;
        if (onProgress) onProgress(n, total, k);
        return handle.renderPage(n, { maxWidth: 1400 }).then(function (canvas) {
          return new Promise(function (resolve) {
            var blobKey = pagePrefix(projectId) + n;
            var done = function (blob) {
              if (!blob) { resolve(); return; }
              window.BlobStore.put(blobKey, blob).then(function (ok) {
                if (ok !== false) {
                  bytes += blob.size || 0;
                  pages.push({ n: n, blobKey: blobKey, w: canvas.width, h: canvas.height });
                }
                resolve();
              }, resolve);
            };
            if (canvas.toBlob) canvas.toBlob(done, 'image/jpeg', 0.82);
            else done(null);
          });
        }, function () { /* one bad page must not stop the rest */ });
      };
    }
    for (var k = 0; k < order.length; k++) chain = chain.then(step(order[k], k + 1));

    return chain.then(function () {
      pages.sort(function (a, b) { return a.n - b.n; });
      return { pages: pages, bytes: bytes, total: total };
    });
  }

  /** Pinch / drag / double-tap zoom over one <img> inside a fixed frame. */
  function wireZoom(frame, img) {
    var s = 1, tx = 0, ty = 0;
    var pts = {}, ids = [];
    var startDist = 0, startScale = 1, lastX = 0, lastY = 0;

    function apply() {
      img.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
      frame.classList.toggle('zoomed', s > 1.01);
    }
    function clampPan() {
      var r = frame.getBoundingClientRect();
      var mx = Math.max(0, (r.width * (s - 1)) / 2);
      var my = Math.max(0, (r.height * (s - 1)) / 2);
      tx = Math.max(-mx, Math.min(mx, tx));
      ty = Math.max(-my, Math.min(my, ty));
    }
    function setScale(next, cx, cy) {
      next = Math.max(1, Math.min(6, next));
      if (cx !== undefined) {
        var r = frame.getBoundingClientRect();
        var ox = cx - r.left - r.width / 2;
        var oy = cy - r.top - r.height / 2;
        var k = next / s;
        tx = ox - (ox - tx) * k;
        ty = oy - (oy - ty) * k;
      }
      s = next;
      clampPan();
      apply();
    }
    function mid() {
      var a = pts[ids[0]], b = pts[ids[1]];
      var dx = b.x - a.x, dy = b.y - a.y;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.sqrt(dx * dx + dy * dy) };
    }

    C.on(frame, 'pointerdown', function (e) {
      if (ids.length >= 2) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      ids.push(e.pointerId);
      try { frame.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (ids.length === 1) { lastX = e.clientX; lastY = e.clientY; }
      else { var m = mid(); startDist = m.d || 1; startScale = s; }
    });
    C.on(frame, 'pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (ids.length >= 2) {
        var m = mid();
        setScale(startScale * (m.d / startDist), m.x, m.y);
        e.preventDefault();
        return;
      }
      if (s <= 1.01) return;              // nothing to pan at 1x
      tx += e.clientX - lastX;
      ty += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      clampPan();
      apply();
      e.preventDefault();
    });
    function drop(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      var at = ids.indexOf(e.pointerId);
      if (at >= 0) ids.splice(at, 1);
      if (ids.length === 1 && pts[ids[0]]) { lastX = pts[ids[0]].x; lastY = pts[ids[0]].y; }
    }
    C.on(frame, 'pointerup', drop);
    C.on(frame, 'pointercancel', drop);
    C.on(frame, 'dblclick', function (e) { setScale(s > 1.01 ? 1 : 2.5, e.clientX, e.clientY); });
    C.on(frame, 'wheel', function (e) {
      e.preventDefault();
      setScale(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    });

    return {
      reset: function () { s = 1; tx = 0; ty = 0; pts = {}; ids = []; apply(); },
      zoomIn: function () { setScale(s * 1.5); },
      zoomOut: function () { setScale(s / 1.5); },
      scale: function () { return s; }
    };
  }

  /** The page viewer sheet. Opens on `pageNo` (the step's page) by default. */
  function openPageViewer(projectId, pageNo, outline) {
    var proj = Store.project(projectId);
    if (!proj) return;
    var d = dataOf(proj);
    if (!d.pages.length) { C.toast('No page images yet'); return; }

    var stepPage = typeof pageNo === 'number' ? pageNo : d.pages[0].n;
    var idx = 0;
    for (var i = 0; i < d.pages.length; i++) if (d.pages[i].n === stepPage) idx = i;

    // Wave K: the shell's one page viewer (pinch, keyboard, an outlined frame).
    if (C.pageViewer && window.PageViewer && typeof window.PageViewer.open === 'function') {
      var pv = null;
      try {
        pv = C.pageViewer({
          title: 'Page ' + stepPage,
          label: 'Booklet page',
          pages: d.pages.map(function (row) { return { label: 'Page ' + row.n, blobKey: row.blobKey, w: row.w, h: row.h }; }),
          index: idx,
          focusZoom: 1.3,
          outline: outline ? function (k) {
            return d.pages[k] && d.pages[k].n === stepPage
              ? { fx: outline.x0, fy: outline.y0, fw: outline.x1 - outline.x0, fh: outline.y1 - outline.y0 } : null;
          } : null,
          onEmpty: function () { return 'That page image is not on this device any more — import the PDF again to bring it back.'; }
        });
      } catch (e) { pv = null; }
      if (pv) return;
    }

    var url = null;
    var api = null;
    var frame, img, empty, label, prev, next, backBtn, zoom;

    function revoke() {
      if (!url) return;
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      url = null;
    }

    function show(i) {
      idx = Math.max(0, Math.min(i, d.pages.length - 1));
      var row = d.pages[idx];
      label.textContent = 'Page ' + row.n + ' · ' + (idx + 1) + ' of ' + d.pages.length;
      prev.disabled = idx <= 0;
      next.disabled = idx >= d.pages.length - 1;
      backBtn.hidden = !(row.n !== stepPage && pageRow(d, stepPage));
      if (api) api.title.textContent = 'Page ' + row.n;
      zoom.reset();
      img.hidden = true;
      empty.hidden = true;
      revoke();
      if (!blobsAvailable()) { empty.hidden = false; return; }
      var want = row.blobKey;
      window.BlobStore.get(want).then(function (blob) {
        if (!blob) { empty.hidden = false; return; }
        if (d.pages[idx].blobKey !== want) return;     // moved on already
        url = URL.createObjectURL(blob);
        img.src = url;
        img.alt = 'Page ' + row.n + ' of the instruction booklet';
        img.hidden = false;
      }, function () { empty.hidden = false; });
    }

    api = C.openSheet({
      title: 'Page ' + d.pages[idx].n,
      cls: 'sheet-sewing sheet-sw-page',
      build: function (body, sheet) {
        api = sheet;
        frame = C.el('div', 'sw-page-frame');
        img = document.createElement('img');
        img.className = 'sw-page-img';
        img.draggable = false;
        img.alt = '';
        frame.appendChild(img);
        empty = C.el('p', 'muted sw-page-empty',
          'That page image is not on this device any more — import the PDF again to bring it back.');
        empty.hidden = true;
        frame.appendChild(empty);
        body.appendChild(frame);

        var bar = C.el('div', 'sw-pagebar');
        prev = C.button('sw-page-nav', '‹', 'Previous page');
        next = C.button('sw-page-nav', '›', 'Next page');
        label = C.el('span', 'sw-page-label');
        C.on(prev, 'click', function () { show(idx - 1); });
        C.on(next, 'click', function () { show(idx + 1); });
        var out = C.button('sw-page-nav', '−', 'Zoom out');
        var into = C.button('sw-page-nav', '＋', 'Zoom in');
        C.on(out, 'click', function () { zoom.zoomOut(); });
        C.on(into, 'click', function () { zoom.zoomIn(); });
        bar.appendChild(prev);
        bar.appendChild(label);
        bar.appendChild(out);
        bar.appendChild(into);
        bar.appendChild(next);
        body.appendChild(bar);

        backBtn = C.button('linkish block sw-page-back', '↩ jump to this step’s page');
        C.on(backBtn, 'click', function () {
          for (var k = 0; k < d.pages.length; k++) if (d.pages[k].n === stepPage) show(k);
        });
        body.appendChild(backBtn);

        body.appendChild(C.el('p', 'field-hint',
          'Pinch or double-tap to zoom, drag to move it. ' + STORED_HERE));

        zoom = wireZoom(frame, img);
        show(idx);
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (a) { a.close(); } }],
      onClose: revoke
    });
  }

  /** ⋯ menu → Pages: every stored page as a thumbnail. */
  function openPagesSheet(projectId) {
    var proj = Store.project(projectId);
    if (!proj) return;
    var urls = [];

    C.openSheet({
      title: 'Pages',
      cls: 'sheet-sewing sheet-sw-pages',
      build: function (body, api) {
        var d = dataOf(Store.project(projectId) || proj);
        if (!d.pages.length) {
          body.appendChild(C.el('p', 'muted',
            'No page images yet. Import the instruction PDF from the ⋯ menu and tick ' +
            '“Keep the pages so you can see the diagrams”.'));
          return;
        }
        body.appendChild(C.el('p', 'muted',
          STORED_HERE + ' A plain .json backup leaves them out.' +
          (d.pages.length >= MAX_PAGES
            ? ' Only the first ' + MAX_PAGES + ' pages of a booklet are kept.' : '')));

        var grid = C.el('div', 'sw-page-grid');
        d.pages.forEach(function (row) {
          var cell = C.button('sw-page-thumb', null, 'Open page ' + row.n);
          var imgWrap = C.el('span', 'sw-thumb-img');
          cell.appendChild(imgWrap);
          cell.appendChild(C.el('span', 'sw-thumb-label', 'Page ' + row.n));
          C.on(cell, 'click', function () { openPageViewer(projectId, row.n); });
          grid.appendChild(cell);
          if (!blobsAvailable()) { imgWrap.textContent = '—'; return; }
          window.BlobStore.get(row.blobKey).then(function (blob) {
            if (!blob) { imgWrap.textContent = '—'; return; }
            var u = URL.createObjectURL(blob);
            urls.push(u);
            var im = document.createElement('img');
            im.src = u;
            im.alt = 'Page ' + row.n;
            imgWrap.appendChild(im);
          }, function () { imgWrap.textContent = '—'; });
        });
        body.appendChild(grid);

        var del = C.button('linkish block', 'Delete the page images');
        C.on(del, 'click', function () {
          C.confirmSheet({
            title: 'Delete the page images?',
            message: 'The steps and everything else stay. You can render the pages again by ' +
              'importing the PDF with the pages box ticked.',
            confirmText: 'Delete'
          }).then(function (ok) {
            if (!ok) return;
            var done = function () {
              edit(projectId, function (dd) { dd.pages = []; });
              api.close();
              C.toast('Page images deleted');
              paint(Store.project(projectId));
            };
            if (blobsAvailable()) window.BlobStore.deletePrefix(pagePrefix(projectId)).then(done, done);
            else done();
          });
        });
        body.appendChild(del);
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (a) { a.close(); } }],
      onClose: function () {
        urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
      }
    });
  }

  /* ================================================================== *
   * 4c. The 2D cutting table (research §B.4.6)
   *
   * Flat, 2D and about pieces, not stitches: one rounded rectangle per
   * cutting entry, width ∝ qty, filling with the accent colour as pieces
   * are cut — plus a thin ring round the step number. No WebGL, no new
   * dependency, theme variables only.
   * ================================================================== */

  var CT_W = 340;      // user units; the SVG scales to the card width
  var CT_H = 20;       // piece height
  var CT_ROW = 26;     // row pitch
  var CT_GAP = 6;

  /** The progress ring drawn round the step number. */
  function stepRing() {
    var R = 15;
    var CIRC = 2 * Math.PI * R;
    var node = svgNode('svg', { 'class': 'sw-step-ring', viewBox: '0 0 36 36', role: 'img' });
    node.appendChild(svgNode('circle', { 'class': 'sw-ring-track', cx: 18, cy: 18, r: R }));
    var arc = svgNode('circle', {
      'class': 'sw-ring-arc', cx: 18, cy: 18, r: R, transform: 'rotate(-90 18 18)',
      'stroke-dasharray': CIRC.toFixed(2), 'stroke-dashoffset': CIRC.toFixed(2)
    });
    node.appendChild(arc);
    var text = svgNode('text', {
      'class': 'sw-ring-num', x: 18, y: 18, 'text-anchor': 'middle', 'dominant-baseline': 'central'
    });
    node.appendChild(text);
    return {
      node: node,
      set: function (at, total) {
        node.style.display = total ? '' : 'none';
        if (!total) return;
        text.textContent = String(at);
        var frac = Math.max(0, Math.min(1, at / total));
        arc.setAttribute('stroke-dashoffset', (CIRC * (1 - frac)).toFixed(2));
        node.setAttribute('aria-label', 'Step ' + at + ' of ' + total);
      }
    };
  }

  function cutTableSig(d) {
    var bits = [];
    for (var i = 0; i < d.cutting.length; i++) bits.push(d.cutting[i].id + ':' + d.cutting[i].qty);
    return bits.join('|');
  }

  function buildCutTable(host, d) {
    C.clear(host);
    var fills = [];
    var x = 0, y = 0;
    var g = svgNode('g');
    for (var i = 0; i < d.cutting.length; i++) {
      var row = d.cutting[i];
      var w = Math.max(28, Math.min(96, 22 * row.qty));
      if (x + w > CT_W && x > 0) { x = 0; y += CT_ROW; }
      var piece = svgNode('g', { 'class': 'sw-ct-piece' });
      piece.appendChild(svgNode('rect', { 'class': 'sw-ct-bg', x: x, y: y, width: w, height: CT_H, rx: 5 }));
      var fill = svgNode('rect', { 'class': 'sw-ct-fill', x: x, y: y, width: 0, height: CT_H, rx: 5 });
      piece.appendChild(fill);
      if (w >= 40) {
        var t = svgNode('text', {
          'class': 'sw-ct-name', x: x + w / 2, y: y + CT_H / 2,
          'text-anchor': 'middle', 'dominant-baseline': 'central'
        });
        t.textContent = clip(row.piece, Math.max(3, Math.floor((w - 6) / 4.6)));
        piece.appendChild(t);
      }
      g.appendChild(piece);
      fills.push({ node: piece, fill: fill, w: w });
      x += w + CT_GAP;
    }
    var total = y + CT_H;
    var node = svgNode('svg', {
      'class': 'sw-ct', viewBox: '0 0 ' + CT_W + ' ' + total,
      width: CT_W, height: total, preserveAspectRatio: 'xMinYMin meet', 'aria-hidden': 'true'
    });
    node.appendChild(g);
    host.appendChild(node);
    host.__fills = fills;
  }

  /** Repaint the fills. The shapes are rebuilt only when the list itself changes. */
  function paintCutTable(d) {
    var host = view.cutTable;
    if (!host) return;
    if (!d.cutting.length) { host.hidden = true; host.__sig = null; return; }
    host.hidden = false;
    var sig = cutTableSig(d);
    if (host.__sig !== sig) { buildCutTable(host, d); host.__sig = sig; }
    var fills = host.__fills || [];
    for (var i = 0; i < fills.length && i < d.cutting.length; i++) {
      var row = d.cutting[i];
      var frac = row.qty > 0 ? Math.max(0, Math.min(1, row.cutCount / row.qty)) : 0;
      var w = fills[i].w * frac;
      // Both, so a browser without the SVG2 geometry property still draws it.
      fills[i].fill.setAttribute('width', w.toFixed(1));
      fills[i].fill.style.width = w.toFixed(1) + 'px';
      fills[i].node.classList.toggle('done', frac >= 1);
      fills[i].node.classList.toggle('part', frac > 0 && frac < 1);
    }
    host.setAttribute('aria-label', cutLine(d) + ' — open the cutting list');
  }

  /* ================================================================== *
   * 5. The import sheet
   * ================================================================== */

  var GROUPS = [
    { id: 'steps', label: 'Steps', count: function (pr) { return pr.steps.length; }, note: function (pr) {
      if (!pr.steps.length) return '';
      // Plain words: how many printed steps the cards make, not the numbering style.
      var m = pr.steps[0].marker;
      var bits = [];
      var ps = null;
      try { ps = S.printedSteps ? S.printedSteps(pr.steps) : null; } catch (e) { ps = null; }
      if (ps && ps.total && ps.total !== pr.steps.length) bits.push(ps.total + ' printed steps on ' + pr.steps.length + ' cards');
      if (m === 'none') bits.push('made from paragraphs');
      var nv = (pr.variations || []).length;
      if (nv) bits.push('+ ' + plural(nv, 'optional extra') + ', not counted');
      return bits.length ? '(' + bits.join(' · ') + ')' : '';
    } },
    { id: 'cutting', label: 'Cutting list', count: function (pr) { return pr.cuttingList.length; }, note: function (pr) {
      var by = {};
      pr.cuttingList.forEach(function (r) { by[r.material] = (by[r.material] || 0) + 1; });
      var bits = [];
      MATERIAL_ORDER.forEach(function (m) { if (by[m]) bits.push(MATERIAL_NAMES[m].toLowerCase() + ' ' + by[m]); });
      return bits.length ? '(' + bits.join(' · ') + ')' : '';
    } },
    { id: 'notions', label: 'Notions', count: function (pr) { return pr.notions.length; }, note: function () { return ''; } },
    { id: 'sizes', label: 'Sizes', count: function (pr) { return pr.sizes ? pr.sizes.labels.length : 0; }, note: function (pr) {
      if (!pr.sizes) return '';
      var l = pr.sizes.labels;
      return '(' + l[0] + '–' + l[l.length - 1] + ')';
    } },
    { id: 'fabric', label: 'Fabric', count: function (pr) { return pr.fabric.length; }, note: function (pr) {
      // Distinct printed bolt widths: a quilt's yardage rows and a lining row
      // print none, and "13 found (13 widths)" was wrong (sewing-audit).
      var seenW = {}, nW = 0;
      pr.fabric.forEach(function (r) {
        var k = String(r.width || '').replace(/\s+/g, '').toLowerCase();
        if (k && !seenW[k]) { seenW[k] = 1; nW++; }
      });
      return nW ? '(' + plural(nW, 'bolt width') + ')' : '';
    } },
    { id: 'seamAllowance', label: 'Seam allowance', count: function (pr) { return pr.seamAllowance ? 1 : 0; }, note: function (pr) {
      if (!pr.seamAllowance) return '';
      var sa = pr.seamAllowance;
      var bits = [];
      if (typeof sa.mm === 'number') bits.push(sa.mm >= 10 ? (sa.mm / 10) + ' cm' : sa.mm + ' mm');
      if (sa.inches) bits.push('(' + sa.inches + '")');
      if (sa.exceptions && sa.exceptions.length) bits.push('+ ' + plural(sa.exceptions.length, 'exception'));
      return bits.join(' ');
    } },
    { id: 'units', label: 'Block counters', count: function (pr) { return pr.units.length; }, note: function (pr) {
      return pr.units.length ? '(' + pr.units[0].name + ')' : '';
    } }
  ];

  function squashName(s) { return String(s || '').toLowerCase().replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, ''); }

  /**
   * P14: 'Gathered Sundress' instead of 'sew-sundress'. Only a name the app
   * gave (empty, the file's name, a default) is replaced; a name the sewist
   * typed is never touched.
   */
  /**
   * The pattern's name from the parse, or '' when what came back is plainly not a name
   * (sew-audit: Moda Charm Monday came back "Binding 5/8 yard"): an amount or a
   * requirements heading is never a project name; the file's name is kept instead.
   */
  function patternNameOf(parsed, fileName) {
    var name = '';
    try { name = S.projectName ? S.projectName(parsed, fileName) || '' : ''; } catch (e) { name = ''; }
    if (!name) return '';
    if (/\d\s*(?:\/\s*\d+\s*)?(?:yards?|yds?|metres?|meters?|m|cm|mm|in|inch(?:es)?|")(?:\s|$|[.,;)])/i.test(name)) return '';
    if (/^(?:binding|backing|batting|fabric|fabrics|cutting|finished|materials?|requirements?|notions?|supplies|yardage|instructions?|sewing|size|sizes)\b/i.test(name)) return '';
    return name;
  }

  function renameFromPattern(projectId, parsed, file) {
    if (!S.projectName || typeof Store.updateProject !== 'function') return false;
    var p = Store.project(projectId);
    if (!p) return false;
    var name = patternNameOf(parsed, file && file.name);
    if (!name || name === p.name) return false;
    var cur = squashName(p.name);
    var generic = !cur || /^(untitled|newproject|sewing|sewingproject|myproject|project|newsewingproject|garment|bag|quilt)\d*$/.test(cur);
    var fromFile = file && file.name && cur === squashName(file.name);
    if (!generic && !fromFile) return false;
    try { Store.updateProject(projectId, { name: name }); } catch (e) { return false; }
    return true;
  }

  /**
   * P1 / S4: find each step's own drawing in the PDF and keep a clean crop of
   * it (SewFigures, sew-visual). Runs after the import, in the background,
   * outside the undo stack; a step with no clean figure keeps its page frame
   * ('rect:…') so the page viewer can outline it. Never a half crop.
   */
  /** After an import with a PDF: the figures, then the quilt model and swatches, one after the other. */
  function afterImportCaptures(projectId, file, figs) {
    if (!file) return Promise.resolve(null);
    lastFiles[projectId] = file;
    var first = figs ? captureFigures(projectId, file) : Promise.resolve(null);
    return first.then(null, function () { return null; }).then(function () {
      return captureImportExtras(projectId, file);
    });
  }

  var figureJobs = {};
  function captureFigures(projectId, file) {
    var F = window.SewFigures;
    if (!F || typeof F.link !== 'function' || typeof F.readPages !== 'function' || typeof F.renderCrops !== 'function') return Promise.resolve(null);
    if (!file || !blobsAvailable() || !window.PdfText || !window.PdfText.isAvailable()) return Promise.resolve(null);
    var p = Store.project(projectId);
    if (!p) return Promise.resolve(null);
    var d = dataOf(p);
    var pages = [], seen = {};
    d.steps.forEach(function (s) { if (typeof s.page === 'number' && s.page > 0 && !seen[s.page]) { seen[s.page] = 1; pages.push(s.page); } });
    pages = pages.slice(0, MAX_PAGES);
    if (!pages.length) return Promise.resolve(null);
    if (figureJobs[projectId]) { try { figureJobs[projectId].abort(); } catch (e) { /* ignore */ } }
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var job = ctl || { abort: function () {} };
    figureJobs[projectId] = job;
    var signal = ctl ? ctl.signal : undefined;
    var handle = null;
    function done(v) {
      if (handle && handle.destroy) { try { handle.destroy(); } catch (e) { /* ignore */ } }
      if (figureJobs[projectId] === job) delete figureJobs[projectId];
      return v;
    }
    return window.PdfText.open(file, { signal: signal }).then(function (h) {
      handle = h;
      return F.readPages(h, pages, { signal: signal });
    }).then(function (infos) {
      var steps = dataOf(Store.project(projectId) || p).steps;
      var links = F.link(steps, infos || {}, {}) || [];
      return F.renderCrops(projectId, links, { handle: handle }, { signal: signal, modes: ['figure'] }).then(function (crops) {
        return { links: links, crops: crops || [], steps: steps };
      });
    }).then(function (r) {
      var byIndex = {};
      r.crops.forEach(function (c, i) { if (c && c.blobKey) byIndex[typeof c.index === 'number' ? c.index : i] = c; });
      var nFig = 0, nPage = 0;
      edit(projectId, function (dd) {
        r.links.forEach(function (lk, i) {
          var idx = typeof lk.index === 'number' ? lk.index : i;
          var st = dd.steps[idx];
          if (!st || (lk.stepId && st.id !== lk.stepId)) return;
          var crop = byIndex[idx];
          // step.fig is the stored shape (sew-core keeps it across split / merge / re-import);
          // the old imageRef string is cleared so the two never disagree.
          if (lk.mode === 'figure' && crop && crop.mode !== 'page') {
            st.fig = { kind: 'crop', page: typeof lk.page === 'number' ? lk.page : null, blobKey: crop.blobKey };
            if (typeof lk.confidence === 'number') st.fig.confidence = lk.confidence;
            nFig++;
          } else if (lk.rect && typeof lk.page === 'number') {
            st.fig = { kind: 'page', page: lk.page, rect: { x0: lk.rect.x0, y0: lk.rect.y0, x1: lk.rect.x1, y1: lk.rect.y1 } };
            if (lk.reason) st.fig.reason = String(lk.reason).slice(0, 80);
            nPage++;
          } else delete st.fig;
          st.imageRef = null;
        });
      }, 'figures', { undo: false, quiet: true });
      var pr = Store.project(projectId);
      if (pr && viewProjectId === projectId) paint(pr);
      refreshWork();
      if (nFig) C.toast('Found the drawing for ' + plural(nFig, 'step') + ' of ' + r.steps.length, { ms: 3200 });
      return done({ figures: nFig, framed: nPage, steps: r.steps.length });
    }).then(null, function () { return done(null); });
  }

  function openImportSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var parsed = null;
    var checks = {};
    var dropZone = null;
    var reviewWrap = null;
    var pasteArea = null;
    var importBtn = null;
    // Page images: the File is stashed from the drop zone's `confirm` hook so
    // the text still goes through the full extract() pipeline (running heads
    // and all — see the caveat in docs/CRAFTS.md) and the pages are rendered
    // from a second, separate PdfText.open only when the box is ticked.
    var pdfFile = null;
    var pdfPages = 0;
    var lastColumns = 0;
    // Wave K (P1, owner sign-off on all proposals): the pages are kept by
    // default so the step's own drawing can be shown; the box still says what it costs.
    var wantPages = true;
    var wantFigures = true;
    var pageHandle = null;
    var cancelled = false;
    var emptyPages = [];
    var lastCheck = null;
    var demoter = null;

    var api = C.openSheet({
      title: 'Import pattern',
      cls: 'sheet-sewing sheet-import',
      build: function (body, self) {
        body.appendChild(C.el('p', 'muted', 'Everything happens on your phone — the pattern never leaves it.'));

        dropZone = C.pdfDropZone({
          label: 'Drop the instruction PDF here, or choose a file',
          tour: 'sw-drop',
          ariaLabel: 'Choose an instruction PDF',
          confirm: function (file) {
            pdfFile = file;
            return true;
          },
          onText: function (res) {
            dropZone.showResult(res);
            pdfPages = res.pages || 0;
            emptyPages = res.emptyPages || [];
            takeText(res.text, res.columnsDetected);
          },
          onError: function () {
            C.toast('Couldn’t read that PDF (its pages may be pictures, with no text to read)', { ms: 4200 });
          }
        });
        body.appendChild(dropZone);

        // "Paste instead" — for patterns that live on a web page.
        var details = document.createElement('details');
        details.className = 'sw-paste';
        var sum = document.createElement('summary');
        sum.textContent = 'Paste instead';
        details.appendChild(sum);
        pasteArea = C.textArea('', 'sw-paste-area', 'Paste the instructions here — mess is fine.');
        pasteArea.setAttribute('aria-label', 'Paste the pattern text');
        details.appendChild(pasteArea);
        var readBtn = C.button('btn ghost block', 'Read this text');
        C.on(readBtn, 'click', function () {
          var text = pasteArea.value;
          if (!text.replace(/\s/g, '')) { C.toast('Paste the instructions first'); return; }
          pdfFile = null;
          pdfPages = 0;
          takeText(text, 0);
        });
        details.appendChild(readBtn);
        body.appendChild(details);

        reviewWrap = C.el('div', 'sw-review');
        body.appendChild(reviewWrap);
      },
      footer: [
        { text: 'Just keep the text', cls: 'btn ghost', onClick: function (a) { applyImport(true, a); a.close(); } },
        { text: 'Import', cls: 'btn primary', onClick: function (a) {
          // A check that says "off" asks first; it never blocks (BUILD.md).
          var g = lastCheck && C.check && C.check.guard ? C.check.guard(lastCheck) : Promise.resolve(true);
          g.then(function (ok) { if (ok && applyImport(false, a)) a.close(); });
        } }
      ],
      onClose: function () {
        cancelled = true;
        if (dropZone && dropZone.destroy) dropZone.destroy();
        if (pageHandle && pageHandle.destroy) {
          try { pageHandle.destroy(); } catch (e) { /* ignore */ }
        }
        pageHandle = null;
      }
    });

    // The footer buttons are the last two children of .sheet-foot.
    window.setTimeout(function () {
      var foot = api.dialog.querySelector('.sheet-foot');
      if (foot) importBtn = foot.lastChild;
      syncFooter();
    }, 0);

    function syncFooter() {
      if (importBtn) importBtn.disabled = !parsed;
      if (importBtn && C.check && C.check.demote) {
        if (!demoter) demoter = C.check.demote(importBtn, lastCheck || { verdict: 'unchecked', rows: [] });
        else if (demoter.set) demoter.set(lastCheck || { verdict: 'unchecked', rows: [] });
      }
    }

    function takeText(text, columns) {
      if (!text || !text.replace(/\s/g, '')) {
        C.toast('There was no text in that file');
        return;
      }
      if (text.replace(/\s/g, '').length < 200) {
        C.toast('These pages are pictures, so there is no text to read', { ms: 4200 });
        return;
      }
      lastColumns = columns || 0;
      try {
        parsed = S.parse(text, { columns: lastColumns });
      } catch (e) {
        parsed = null;
        C.toast('That pattern could not be read');
        return;
      }
      checks = {};
      GROUPS.forEach(function (g) { checks[g.id] = g.count(parsed) > 0; });
      lastCheck = null;
      if (S.importCheck) {
        try { lastCheck = S.importCheck(parsed, { emptyPages: pdfFile ? emptyPages : [], pages: pdfFile ? pdfPages : 0 }); } catch (e) { lastCheck = null; }
      }
      renderReview();
      syncFooter();
    }

    function renderReview() {
      C.clear(reviewWrap);
      if (!parsed) return;
      // Gap 8: what was missed, with its pages, through the shell's check sheet.
      if (lastCheck && C.check && C.check.line && lastCheck.rows && lastCheck.rows.length) {
        var chk = lastCheck;
        reviewWrap.appendChild(C.check.line(chk, {
          onOpen: function () { C.check.open(chk, { title: chk.title || 'What was read' }); }
        }));
      }
      // Pages that are pictures of text: the opt-in reader (shell-ui §9). What it reads is
      // shown as a check to read through, never put into the steps silently.
      if (pdfFile && emptyPages.length && C.ocr && typeof C.ocr.offerButton === 'function' &&
          (typeof C.ocr.available !== 'function' || C.ocr.available())) {
        var pagesToRead = emptyPages.map(Number).filter(function (n) { return n > 0; }).slice(0, 20);
        var ob = C.ocr.offerButton({
          text: 'Try reading the ' + plural(pagesToRead.length, 'picture page') + ' on this phone',
          reason: 'Pages ' + pagesToRead.join(', ') + ' of this booklet are pictures of text.',
          onReady: function (Ocr) { readPicturePages(Ocr, pagesToRead); }
        });
        if (ob) reviewWrap.appendChild(ob);
      }
      var kindWord = parsed.kind && parsed.kind !== 'unknown' ? vocabOf({ kind: parsed.kind }).kindWord : '';
      var pname = patternNameOf(parsed, pdfFile && pdfFile.name);
      if (kindWord || pname) {
        reviewWrap.appendChild(C.el('p', 'muted sw-review-kind',
          (pname ? '“' + pname + '”' : 'This pattern') + (kindWord ? ' reads as a ' + kindWord + '.' : '.')));
      }
      reviewWrap.appendChild(C.el('div', 'sw-group-head', 'What was found'));
      var list = C.el('div', 'list sw-review-list');
      GROUPS.forEach(function (g) {
        var n = g.count(parsed);
        // P14: a bag or a quilt never reads "Sizes: none found", a garment never
        // "Block counters: none found" (they were never going to be there).
        if (!n && ((g.id === 'sizes' && (parsed.kind === 'bag' || parsed.kind === 'quilt')) ||
            (g.id === 'units' && parsed.kind !== 'quilt'))) return;
        var row = C.el('div', 'list-item sw-review-row' + (n ? '' : ' sw-empty-row'));
        var check = C.button('check', '✓', g.label + ', ' + n + ' found');
        check.setAttribute('role', 'checkbox');
        check.setAttribute('aria-checked', checks[g.id] ? 'true' : 'false');
        check.disabled = !n;
        C.on(check, 'click', function () {
          checks[g.id] = !checks[g.id];
          check.setAttribute('aria-checked', checks[g.id] ? 'true' : 'false');
        });
        var text = C.el('span', 'item-text');
        text.appendChild(C.el('span', 'sw-review-label', g.label));
        text.appendChild(C.el('span', 'sw-review-count', n ? (n + ' found ' + (g.note(parsed) || '')) : 'none found'));
        var expand = C.button('item-del', '▸', 'Show the ' + g.label.toLowerCase());
        expand.disabled = !n;
        C.on(expand, 'click', function () { openGroupPreview(g); });
        row.appendChild(check);
        row.appendChild(text);
        row.appendChild(expand);
        list.appendChild(row);

        // Research risk #1: a minority of booklets number nothing. Offer the
        // recovery path right where the disappointing count is.
        if (g.id === 'steps' && parsed.sourceText) {
          var act = C.el('div', 'list-item sw-para-action');
          var make = C.button('linkish', n ? 'Not right? Make steps from paragraphs' : '＋ Make steps from paragraphs');
          C.on(make, 'click', makeStepsFromParagraphs);
          act.appendChild(make);
          list.appendChild(act);
        }
      });
      // Opt-in page images. Only for a PDF, only when IndexedDB is there, and
      // off by default — this is the one line in the app that can eat 10 MB.
      if (pdfFile && pdfPages && blobsAvailable()) {
        var capped = Math.min(pdfPages, MAX_PAGES);
        var pageRowNode = C.el('div', 'list-item sw-review-row sw-pages-row');
        var pageCheck = C.button('check', '✓', 'Keep the pages so you can see the diagrams');
        pageCheck.setAttribute('role', 'checkbox');
        pageCheck.setAttribute('aria-checked', wantPages ? 'true' : 'false');
        pageCheck.classList.toggle('on', wantPages);
        C.on(pageCheck, 'click', function () {
          wantPages = !wantPages;
          pageCheck.setAttribute('aria-checked', wantPages ? 'true' : 'false');
          pageCheck.classList.toggle('on', wantPages);
        });
        var pageText = C.el('span', 'item-text');
        pageText.appendChild(C.el('span', 'sw-review-label', 'Keep the pages so you can see the diagrams'));
        pageText.appendChild(C.el('span', 'sw-review-count',
          'adds ' + sizeEstimate(capped) + ' · ' + STORED_HERE +
          (pdfPages > MAX_PAGES ? ' Only the first ' + MAX_PAGES + ' pages are kept.' : '')));
        pageRowNode.appendChild(pageCheck);
        pageRowNode.appendChild(pageText);
        list.appendChild(pageRowNode);
      }
      // P1: each step's own drawing, cut from the PDF (small; only clean crops are kept).
      if (pdfFile && blobsAvailable() && window.SewFigures && parsed.steps.length) {
        var figRow = C.el('div', 'list-item sw-review-row sw-figs-row');
        var figCheck = C.button('check', '✓', 'Show each step’s own drawing beside it');
        figCheck.setAttribute('role', 'checkbox');
        figCheck.setAttribute('aria-checked', wantFigures ? 'true' : 'false');
        figCheck.classList.toggle('on', wantFigures);
        C.on(figCheck, 'click', function () {
          wantFigures = !wantFigures;
          figCheck.setAttribute('aria-checked', wantFigures ? 'true' : 'false');
          figCheck.classList.toggle('on', wantFigures);
        });
        var figText = C.el('span', 'item-text');
        figText.appendChild(C.el('span', 'sw-review-label', 'Show each step’s own drawing beside it'));
        figText.appendChild(C.el('span', 'sw-review-count',
          'only drawings the app could cut out cleanly; the rest open on their page'));
        figRow.appendChild(figCheck);
        figRow.appendChild(figText);
        list.appendChild(figRow);
      }
      if (parsed.sheet) {
        var shRow = C.el('div', 'list-item sw-review-row');
        var shText = C.el('span', 'item-text');
        shText.appendChild(C.el('span', 'sw-review-label', 'Pattern sheet'));
        shText.appendChild(C.el('span', 'sw-review-count', sheetLine(parsed.sheet) + ' — kept with the project'));
        shRow.appendChild(C.el('span', 'check on', '✓'));
        shRow.appendChild(shText);
        list.appendChild(shRow);
      }

      reviewWrap.appendChild(list);

      if (parsed.warnings.length) {
        var warn = C.el('div', 'sw-warnings');
        parsed.warnings.forEach(function (w) { warn.appendChild(C.el('div', 'sw-warning', '⚠ ' + w)); });
        reviewWrap.appendChild(warn);
      }
    }

    /** Read the picture pages with the opt-in reader and show every line as "check it". */
    function readPicturePages(Ocr, list) {
      if (!Ocr || typeof Ocr.recognize !== 'function' || !pdfFile || !window.PdfText) return;
      C.toast('Reading ' + plural(list.length, 'page') + '…', { ms: 2600 });
      var h = null, lines = [];
      window.PdfText.open(pdfFile).then(function (handle) {
        h = handle;
        var chain = Promise.resolve();
        list.forEach(function (n) {
          chain = chain.then(function () {
            return handle.renderPage(n, { maxWidth: 1700 }).then(function (canvas) {
              return Ocr.recognize(canvas, {}).then(function (res) {
                (res && res.lines ? res.lines : []).forEach(function (l) {
                  if (l && l.text && l.text.replace(/\s/g, '')) lines.push({ text: l.text, conf: l.conf, page: n });
                });
                if (typeof handle.setPageText === 'function' && res && res.lines) {
                  try { handle.setPageText(n, res.lines); } catch (e) { /* ignore */ }
                }
              });
            }, function () { /* a page that does not render is skipped */ });
          });
        });
        return chain;
      }).then(function () {
        if (h && h.destroy) { try { h.destroy(); } catch (e) { /* ignore */ } }
        try { if (typeof Ocr.terminate === 'function') Ocr.terminate(); } catch (e) { /* ignore */ }
        if (!lines.length) { C.toast('No text could be read from those pages'); return; }
        var chk = C.ocr.check(lines, { title: 'Read from a picture: check it' });
        C.check.open(chk, { title: 'Read from a picture: check it' });
        // The sewist can still make steps from it, through the paragraph picker (each one chosen by hand).
        var text = lines.map(function (l) { return l.text; }).join('\n');
        C.toast('Read ' + plural(lines.length, 'line') + '. Check them; nothing was added to the steps.', {
          ms: 6000, actionText: 'Pick steps',
          onAction: function () {
            openParagraphPicker({
              text: text,
              onUse: function (steps) {
                if (!parsed) return;
                parsed.steps = (parsed.steps || []).concat(steps);
                checks.steps = true;
                renderReview();
                syncFooter();
              }
            });
          }
        });
      }, function () {
        if (h && h.destroy) { try { h.destroy(); } catch (e) { /* ignore */ } }
        C.toast('Those pages could not be read');
      });
    }

    /** Re-run the parse with the paragraph fallback on, then let the user prune it. */
    function makeStepsFromParagraphs() {
      if (!parsed || !parsed.sourceText) return;
      var src = parsed.sourceText;
      var refreshed = null;
      try { refreshed = S.parse(src, { fallbackSteps: true, columns: lastColumns }); } catch (e) { refreshed = null; }
      openParagraphPicker({
        text: src,
        onUse: function (steps) {
          if (refreshed) parsed = refreshed;
          parsed.steps = steps;
          parsed.warnings = (parsed.warnings || []).filter(function (w) {
            return String(w).indexOf('No numbered steps found') < 0;
          });
          checks.steps = true;
          renderReview();
          syncFooter();
          C.toast(plural(steps.length, 'step') + ' ready — press Import to keep them', { ms: 3800 });
        }
      });
    }

    function openGroupPreview(g) {
      var rows = [];
      if (g.id === 'steps') {
        rows = parsed.steps.map(function (s, i) { return (i + 1) + '. ' + clip(s.text, 90); })
          .concat((parsed.variations || []).map(function (s) {
            return 'Optional' + (s.section ? ' (' + s.section + ')' : '') + ': ' + clip(s.text, 80);
          }));
      }
      else if (g.id === 'cutting') rows = parsed.cuttingList.map(function (r) { return r.piece + ' × ' + r.qty + ' · ' + MATERIAL_NAMES[r.material]; });
      else if (g.id === 'notions') rows = parsed.notions.map(function (r) { return r.text; });
      else if (g.id === 'sizes' && parsed.sizes) {
        rows = [parsed.sizes.labels.join('  ')].concat(
          parsed.sizes.chart.concat(parsed.sizes.finished).map(function (r) { return r.label + ': ' + r.values.join('  '); })
        );
      } else if (g.id === 'fabric') rows = parsed.fabric.map(function (r) { return r.line || (r.name + ' ' + r.width); });
      else if (g.id === 'seamAllowance' && parsed.seamAllowance) {
        rows = [parsed.seamAllowance.text].concat((parsed.seamAllowance.exceptions || []).map(function (e) { return '— ' + e.text; }));
      } else if (g.id === 'units') rows = parsed.units.map(function (u) { return u.name + ': ' + u.target; });

      C.openSheet({
        title: g.label,
        cls: 'sheet-sewing',
        build: function (b) {
          var list = C.el('div', 'list');
          rows.forEach(function (t) {
            var row = C.el('div', 'list-item');
            row.appendChild(C.el('span', 'item-text', t));
            list.appendChild(row);
          });
          b.appendChild(list);
          b.appendChild(C.el('p', 'field-hint', 'You can edit all of this after importing.'));
        },
        footer: [{ text: 'Done', cls: 'btn primary', onClick: function (a) { a.close(); } }]
      });
    }

    /** @param {boolean} textOnly @param {object} sheetApi */
    function applyImport(textOnly, sheetApi) {
      if (!parsed) {
        if (textOnly) C.toast('Nothing to keep yet');
        return false;
      }
      var groups = {};
      if (textOnly) {
        GROUPS.forEach(function (g) { groups[g.id] = false; });
        groups.meta = false;
      } else {
        GROUPS.forEach(function (g) { groups[g.id] = !!checks[g.id]; });
      }

      var proj = Store.project(projectId);
      var next;
      try {
        next = S.toCraftData(parsed, proj && proj.craftData, { groups: groups });
      } catch (e) {
        C.toast('That import did not work');
        return false;
      }

      Store.updateCraftData(projectId, function () { return next; });
      emitChange(projectId, 'import');

      if (textOnly) {
        C.render();
        C.toast('Kept the text — nothing else changed');
        return true;
      }
      // P14: the pattern's own name, when the project still has a file or default name.
      renameFromPattern(projectId, parsed, pdfFile);
      C.render();
      var bits = [];
      if (groups.steps && parsed.steps.length) {
        // Counted as the step screen counts them: printed steps (a step on two cards is one).
        var psI = null;
        try { psI = S.printedSteps(dataOf(Store.project(projectId)).steps); } catch (e) { psI = null; }
        bits.push(plural(psI && psI.total ? psI.total : parsed.steps.length, 'step'));
      }
      if (groups.cutting && parsed.cuttingList.length) bits.push(plural(parsed.cuttingList.length, 'piece'));
      if (groups.notions && parsed.notions.length) bits.push(plural(parsed.notions.length, 'notion'));
      var summaryText = bits.length ? 'Imported ' + listJoin(bits) + '.' : 'Imported.';

      // The text is already saved; the pages render on top of it, so a cancel
      // (or a dead IndexedDB) still leaves a working project behind.
      if (wantPages && pdfFile && blobsAvailable() && window.PdfText && window.PdfText.isAvailable()) {
        startPageRender(sheetApi, summaryText);
        return false;
      }
      C.toast(summaryText);
      if (pdfFile) afterImportCaptures(projectId, pdfFile, wantFigures && groups.steps);
      return true;
    }

    /** Render the pages with a progress line and a way out. Keeps the sheet open. */
    function startPageRender(sheetApi, summaryText) {
      cancelled = false;
      C.clear(reviewWrap);
      if (dropZone) dropZone.style.display = 'none';
      if (importBtn) importBtn.disabled = true;

      var box = C.el('div', 'sw-page-progress');
      var line = C.el('p', 'muted', 'Opening the PDF…');
      var bar = C.el('div', 'bar');
      var fill = C.el('div', 'bar-fill');
      bar.appendChild(fill);
      var stop = C.button('btn ghost block', 'Stop — keep the pages so far');
      C.on(stop, 'click', function () {
        cancelled = true;
        stop.disabled = true;
        line.textContent = 'Stopping…';
      });
      box.appendChild(line);
      box.appendChild(bar);
      box.appendChild(stop);
      box.appendChild(C.el('p', 'field-hint', STORED_HERE));
      reviewWrap.appendChild(box);

      // The step and layout pages go first (05 #10).
      // Construction pages, then the cutting layouts, then the optional extras.
      var priority = [];
      if (parsed) {
        var pagesOf = function (list) {
          return (list || []).map(function (s) { return s.page; }).filter(function (n) { return typeof n === 'number'; })
            .sort(function (a, b) { return a - b; });
        };
        priority = pagesOf(parsed.steps);
        try { priority = priority.concat(S.layoutPages(parsed.sourceText)); } catch (e) { /* ignore */ }
        priority = priority.concat(pagesOf(parsed.variations));
      }
      var nPriority = 0;
      window.PdfText.open(pdfFile).then(function (handle) {
        pageHandle = handle;
        var cap = Math.min(handle.numPages || 0, MAX_PAGES);
        nPriority = priority.filter(function (n, i) { return priority.indexOf(n) === i && n >= 1 && n <= cap; }).length;
        // Every page is a step page: plain numbering reads better.
        if (nPriority >= cap) nPriority = 0;
        return renderPageImages(projectId, handle, function (n, total, k) {
          line.textContent = (k <= nPriority ? 'Rendering the step pages first — page ' : 'Rendering page ') +
            n + ' (' + k + ' of ' + total + ')…';
          fill.style.width = Math.round(((k - 1) / total) * 100) + '%';
        }, function () { return cancelled; }, priority);
      }).then(function (res) {
        var pages = (res && res.pages) || [];
        if (pages.length) edit(projectId, function (dd) { dd.pages = pages; });
        C.render();
        sheetApi.close();
        var tail = pages.length
          ? ' Kept ' + plural(pages.length, 'page') + ' (' + fmtBytes(res.bytes) + ').'
          : ' No pages were kept.';
        C.toast(summaryText + tail, { ms: 4600 });
        C.fb('done');
        afterImportCaptures(projectId, pdfFile, wantFigures && checks.steps);
      }, function () {
        C.render();
        sheetApi.close();
        C.toast(summaryText + ' The pages could not be rendered.', { ms: 4600 });
      });
    }
  }

  function fmtBytes(bytes) {
    bytes = bytes || 0;
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function listJoin(bits) {
    if (bits.length <= 1) return bits.join('');
    return bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
  }

  /* ================================================================== *
   * 6. New project, menu, FAQ, tour, registration
   * ================================================================== */

  function newProjectFields(body, c) {
    C = C || c;
    var name = c.textInput('', 'Tansey Top');
    var designer = c.textInput('', 'Peppermint Magazine');
    var size = c.textInput('', 'M');
    body.appendChild(c.field('Pattern name', name, 'Optional — the importer fills this in too.'));
    body.appendChild(c.field('Designer', designer));
    body.appendChild(c.field('Your size', size));
    return {
      get: function () {
        return {
          meta: {
            patternName: name.value.replace(/^\s+|\s+$/g, ''),
            designer: designer.value.replace(/^\s+|\s+$/g, ''),
            version: '', view: '', url: ''
          },
          size: { chosen: size.value.replace(/^\s+|\s+$/g, ''), sizeLabels: [], alterations: '' }
        };
      }
    };
  }

  /* ---- P5: the pattern sheet joins the project ---- */

  /** ⋯ → Add the pattern sheets: read a tiled / A0 / layered sheet PDF into craftData.sheet. */
  function openAddSheet(projectId) {
    if (!S.readSheet || !S.attachSheet) { C.toast('This version cannot read pattern sheets'); return; }
    var file = null, found = null, zone = null, review = null, addBtn = null;
    var api = C.openSheet({
      title: 'Add the pattern sheets',
      cls: 'sheet-sewing sheet-import',
      build: function (body) {
        body.appendChild(C.el('p', 'muted', 'The PDF with the pattern pieces (the one you print and tape together). ' +
          'Read on your phone; nothing is uploaded.'));
        zone = C.pdfDropZone({
          label: 'Drop the pattern sheet PDF here, or choose a file',
          ariaLabel: 'Choose a pattern sheet PDF',
          confirm: function (f) { file = f; return true; },
          onText: function (res) {
            zone.showResult(res);
            readIt(res.text);
          },
          onError: function () { C.toast('Couldn’t read that PDF', { ms: 4200 }); }
        });
        body.appendChild(zone);
        review = C.el('div', 'sw-review');
        body.appendChild(review);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (a) { a.close(); } },
        { text: 'Add to the project', cls: 'btn primary', onClick: function (a) {
          if (!found) return;
          var g = found.check && C.check && C.check.guard ? C.check.guard(found.check) : Promise.resolve(true);
          g.then(function (ok) {
            if (!ok) return;
            var okAttach = false;
            edit(projectId, function (dd) { okAttach = S.attachSheet(dd, found); }, 'sheet');
            a.close();
            paint(Store.project(projectId));
            C.toast(okAttach ? 'Pattern sheet added' : 'Nothing on that sheet could be kept');
            if (okAttach) openSheetView(projectId);
          });
        } }
      ],
      onClose: function () { if (zone && zone.destroy) zone.destroy(); }
    });
    window.setTimeout(function () {
      var foot = api.dialog && api.dialog.querySelector('.sheet-foot');
      addBtn = foot ? foot.lastChild : null;
      if (addBtn) addBtn.disabled = true;
    }, 0);

    function pageFacts(f) {
      // Page sizes (A0 detection) and size layers, when pdf.js gives them.
      if (!f || !window.PdfText || !window.PdfText.isAvailable()) return Promise.resolve({});
      var h = null;
      return window.PdfText.open(f).then(function (handle) {
        h = handle;
        var sizes = [];
        var doc = handle.doc;
        var n = Math.min(handle.numPages || 0, 60);
        var chain = Promise.resolve();
        if (doc && typeof doc.getPage === 'function') {
          for (var i = 1; i <= n; i++) {
            (function (k) {
              chain = chain.then(function () {
                return doc.getPage(k).then(function (pg) {
                  var v = pg.view || [0, 0, 0, 0];
                  sizes.push({ w: Math.abs(v[2] - v[0]), h: Math.abs(v[3] - v[1]) });
                }, function () { sizes.push({ w: 0, h: 0 }); });
              });
            })(i);
          }
        }
        return chain.then(function () {
          return typeof handle.layers === 'function' ? handle.layers().then(null, function () { return null; }) : null;
        }).then(function (ly) {
          var names = ly && ly.layers ? ly.layers.map(function (x) { return x.name; }).filter(Boolean) : [];
          return { pageSizes: sizes.length ? sizes : undefined, layers: names.length ? names : undefined };
        });
      }).then(function (o) {
        if (h && h.destroy) { try { h.destroy(); } catch (e) { /* ignore */ } }
        return o;
      }, function () {
        if (h && h.destroy) { try { h.destroy(); } catch (e) { /* ignore */ } }
        return {};
      });
    }

    function readIt(text) {
      C.clear(review);
      review.appendChild(C.el('p', 'muted', 'Reading the sheet…'));
      pageFacts(file).then(function (facts) {
        try { found = S.readSheet(text || '', facts); } catch (e) { found = null; }
        C.clear(review);
        if (!found || (!found.pieces.length && !found.tiles && !found.layers && !found.paper)) {
          found = null;
          review.appendChild(C.el('p', 'muted', 'No pattern pieces or sheet labels were found in that file.'));
          if (addBtn) addBtn.disabled = true;
          return;
        }
        if (found.check && C.check && C.check.line) {
          var chk = found.check;
          review.appendChild(C.check.line(chk, { onOpen: function () { C.check.open(chk, { title: 'The sheet as read' }); } }));
          if (addBtn && C.check.demote) C.check.demote(addBtn, chk);
        }
        review.appendChild(sheetSummary(found, null));
        if (addBtn) addBtn.disabled = false;
      });
    }
  }

  /** Pieces, paper, test square, layers: shared by the add sheet and the sheet view. */
  function sheetSummary(sh, size) {
    var box = C.el('div', 'sw-sheet-summary');
    if (sh.paper === 'A0' || sh.copyShop || (sh.paper && /^A[0-2]$|large/.test(sh.paper))) {
      box.appendChild(C.el('p', 'sw-sheet-a0', '🖨 Copy-shop file: print it at 100% on ' + (sh.paper || 'large-format') + ' paper.'));
    }
    (sh.test || []).forEach(function (t) {
      box.appendChild(C.el('p', 'sw-sheet-test', '📐 Measure the test square: ' + (t.size || t.text) +
        '. Print at 100% (“Actual size”, no scaling).' + (typeof t.page === 'number' ? ' Page ' + t.page + '.' : '')));
    });
    if (sh.layers && sh.layers.sizes && sh.layers.sizes.length) {
      var mine = size && sh.layers.sizes.some(function (s) { return String(s).toLowerCase() === String(size).toLowerCase(); });
      box.appendChild(C.el('p', 'sw-sheet-layers', 'Size layers: ' + sh.layers.sizes.join(', ') +
        (sh.layers.always && sh.layers.always.length ? ' (always: ' + sh.layers.always.join(', ') + ')' : '') +
        (mine ? '. To print only yours, tick “' + size + '”' + (sh.layers.always && sh.layers.always.length ? ' and “' + sh.layers.always.join('”, “') + '”' : '') + ' in your PDF reader’s layers panel.' : '.')));
    }
    if (sh.pieces && sh.pieces.length) {
      box.appendChild(C.el('div', 'sw-group-head', plural(sh.pieces.length, 'piece')));
      var list = C.el('div', 'list');
      sh.pieces.forEach(function (pc) {
        var row = C.el('div', 'list-item');
        var t = C.el('span', 'item-text');
        t.appendChild(C.el('span', 'sw-sheet-piece', (pc.number !== null && pc.number !== undefined ? pc.number + ' · ' : '') + pc.name));
        t.appendChild(C.el('span', 'sw-sheet-cuts', (pc.cuts || []).map(cutWords).join(' + ') || 'cut as marked'));
        row.appendChild(t);
        if (pc.pages && pc.pages.length) row.appendChild(C.el('span', 'chip', 'p' + pageSpan(pc.pages)));
        list.appendChild(row);
      });
      box.appendChild(list);
    }
    return box;
  }
  function cutWords(c) {
    var mat = c.material === 'main' ? 'main' : c.material;
    if (c.how === 'pair') return c.qty + ' pair' + (c.qty === 1 ? '' : 's') + ' ' + mat;
    if (c.how === 'fold') return c.qty + ' on the fold ' + mat;
    return c.qty + ' × ' + mat;
  }
  function pageSpan(pages) {
    var s = pages.slice().sort(function (a, b) { return a - b; });
    return s.length > 1 && s[s.length - 1] - s[0] === s.length - 1 ? s[0] + '–' + s[s.length - 1] : s.join(', ');
  }

  /** The pattern sheet in the project: tape-up map, pieces, print notes. */
  function openSheetView(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var tape = null;
    C.openSheet({
      title: 'Pattern sheet',
      cls: 'sheet-sewing sheet-sw-sheet',
      build: function (body) {
        var d = dataOf(Store.project(projectId) || p);
        var sh = d.sheet;
        if (!sh) {
          body.appendChild(C.el('p', 'muted', 'No pattern sheet yet.'));
          var add = C.button('btn primary block', 'Add the pattern sheets');
          C.on(add, 'click', function () { openAddSheet(projectId); });
          body.appendChild(add);
          return;
        }
        if (sh.tiles && sh.tiles.tiles && sh.tiles.tiles.length) {
          body.appendChild(C.el('div', 'sw-group-head', 'Tape the sheets together'));
          body.appendChild(C.el('p', 'field-hint', 'Tap a sheet when it is taped.' +
            (sh.tiles.marks === 'joins' ? ' The labels on this pattern mark where the sheets meet, so the app numbers the sheets itself.' : '')));
          var host = C.el('div', 'sw-tape-host');
          body.appendChild(host);
          if (window.SewFigures && typeof window.SewFigures.mountTapeMap === 'function') {
            try {
              tape = window.SewFigures.mountTapeMap(host, sh.tiles, {
                done: sh.taped || {},
                title: 'Tape-up map',
                onTap: function (tile) {
                  var label = tile && tile.label;
                  if (!label) return;
                  edit(projectId, function (dd) {
                    if (!dd.sheet) return;
                    if (!dd.sheet.taped) dd.sheet.taped = {};
                    if (dd.sheet.taped[label]) delete dd.sheet.taped[label]; else dd.sheet.taped[label] = true;
                  }, 'sheet');
                  var now = dataOf(Store.project(projectId));
                  if (tape && now.sheet) tape.update(now.sheet.taped || {});
                  C.fb('tap');
                  if (now.sheet) C.announce(sheetLine(now.sheet));
                  paint(Store.project(projectId));
                }
              });
            } catch (e) { tape = null; }
          }
          if (!tape) host.appendChild(C.el('p', 'muted', sheetLine(sh)));
        }
        body.appendChild(sheetSummary(sh, d.size.chosen));
        (sh.print || []).forEach(function (t) { body.appendChild(C.el('p', 'field-hint', t)); });
        if (!d.cutting.length && sh.pieces.length) {
          var use = C.button('btn ghost block', 'Use these pieces as the cutting list');
          C.on(use, 'click', function () {
            edit(projectId, function (dd) {
              dd.sheet.pieces.forEach(function (pc) {
                (pc.cuts.length ? pc.cuts : [{ qty: 1, how: 'x', material: 'main' }]).forEach(function (c) {
                  dd.cutting.push({
                    id: newId('sc'), piece: pc.name, qty: c.how === 'pair' ? c.qty * 2 : c.qty, cutCount: 0,
                    material: c.material, onFold: c.how === 'fold', grain: '', note: c.how === 'pair' ? 'mirrored pairs' : '', dims: ''
                  });
                });
              });
            }, 'cut');
            C.toast('Cutting list made from the sheet');
            paint(Store.project(projectId));
          });
          body.appendChild(use);
        }
        var again = C.button('linkish block', 'Read another sheet file');
        C.on(again, 'click', function () { openAddSheet(projectId); });
        body.appendChild(again);
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (a) { a.close(); } }],
      onClose: function () { if (tape && tape.destroy) tape.destroy(); tape = null; }
    });
  }

  function menuItems(p) {
    var items = [];
    var d = dataOf(p);
    if (d.pages.length) {
      items.push({ icon: '📄', label: 'Pages', run: function () { openPagesSheet(p.id); } });
    }
    items.push(d.sheet
      ? { icon: '🗺️', label: 'Pattern sheet', run: function () { openSheetView(p.id); } }
      : { icon: '🗺️', label: 'Add the pattern sheets', run: function () { openAddSheet(p.id); } });
    if (vocabOf(d).showSizes) items.push({ icon: '📏', label: 'Size & alterations', run: function () { openSizeSheet(p.id); } });
    // One fabric item: sew-extras' "Fabric and shopping list" also shows what the old sheet did
    // (fabricOwnParts); the old sheet stays only as the fallback when the extras are missing.
    if (!extrasFind(p, /^fabric$/)) items.push({ icon: '🧺', label: 'Fabric', run: function () { openFabricSheet(p.id); } });
    items.push({ icon: '⚙️', label: 'Machine settings', run: function () { openMachineSheet(p.id); } });
    // The sew-extras sheets (cutting board, quilt top, calculators, timer, glossary …).
    extrasItems(p).forEach(function (it) {
      items.push({ icon: it.icon || '•', label: it.label, hint: it.hint, run: function () {
        extrasOpen(it.id, Store.project(p.id) || p, {});
      } });
    });
    return items;
  }

  /* ---- Share a picture (shell-ui §3): the step ring and the current step's drawing ---- */
  function sharePicture(project, opts) {
    var size = (opts && opts.size) || 900;
    var d = dataOf(project);
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var g = canvas.getContext('2d');
    if (!g) return null;
    var ps = S.printedSteps(d.steps);
    var done = ps.total ? S.printedDone(d.steps, ps) : stepsDone(d);
    var total = ps.total || d.steps.length;
    function css(name, fb) { try { return (C.cssVar && C.cssVar(name)) || fb; } catch (e) { return fb; } }
    var primary = css('--primary', '#6b4bd6'), border = css('--border', '#cccccc'), text = css('--text', '#222222');
    function ring() {
      var cx = size / 2, cy = size / 2, r = size * 0.36;
      g.lineWidth = size * 0.06;
      g.strokeStyle = border;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = primary;
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (total ? done / total : 0)); g.stroke();
      g.fillStyle = text;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 ' + Math.round(size * 0.16) + 'px system-ui, sans-serif';
      g.fillText(done + '/' + total, cx, cy - size * 0.02);
      g.font = '500 ' + Math.round(size * 0.05) + 'px system-ui, sans-serif';
      g.fillText('steps done', cx, cy + size * 0.1);
    }
    // The drawing of the last finished step with one, when there is one.
    var key = null;
    for (var i = Math.min(d.currentStep, d.steps.length - 1); i >= 0; i--) {
      var ref = figureRef(d.steps[i]);
      if (ref && ref.kind === 'crop') { key = ref.blobKey; break; }
    }
    if (!key || !blobsAvailable()) { ring(); return canvas; }
    return window.BlobStore.get(key).then(function (blob) {
      if (!blob) { ring(); return canvas; }
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(blob);
        var im = new Image();
        im.onload = function () {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, size, size);
          var s = Math.min(size / im.naturalWidth, size / im.naturalHeight);
          var w = im.naturalWidth * s, h = im.naturalHeight * s;
          g.drawImage(im, (size - w) / 2, (size - h) / 2, w, h);
          URL.revokeObjectURL(url);
          resolve(canvas);
        };
        im.onerror = function () { URL.revokeObjectURL(url); ring(); resolve(canvas); };
        im.src = url;
      });
    }, function () { ring(); return canvas; });
  }

  var FAQ = [
    {
      q: 'How do I get my sewing pattern into the app?',
      a: 'Open the project, tap ⋯ → Import pattern, and drop the instruction booklet PDF on the box. ' +
        'The app reads it on your phone — nothing is uploaded. If your pattern is a web page instead, ' +
        'open “Paste instead” and paste the text.'
    },
    {
      q: 'The importer found the wrong things. What now?',
      a: 'Untick any group that came out wrong before you tap Import, and tap ▸ to see exactly what it found. ' +
        'Everything is editable afterwards: add, rename and delete steps, pieces and notions from their sheets.'
    },
    {
      q: 'Does importing again lose my progress?',
      a: 'No. Steps you have ticked off, pieces you have cut and notions you already have are matched by name ' +
        'and kept. Your size, alterations, machine settings and the pattern link are never overwritten.'
    },
    {
      q: 'What does the cutting counter do?',
      a: 'Tap the “0 of 2 cut” chip each time you cut one of that piece, and − if you counted one too many. ' +
        'For a big quilt row (“0 of 56 cut ▸”) the chip opens a counter with −10, +10, all and none. ' +
        '“2 mirrored” means one pair: a left and a right. The home card counts pieces, not rows.'
    },
    {
      q: 'One step is a whole paragraph. Can I break it up?',
      a: 'Yes. In the step list tap ✎ beside the step and choose the sentence where the new card should start; ' +
        'both cards keep the pattern’s step number (“4 · 1/2”, “4 · 2/2”). The same ✎ also edits the text, adds your own note and offers “Merge with the next ' +
        'card”. Undo puts it back, and importing the pattern again keeps your split.'
    },
    {
      q: 'Can I take the notions list to the shop?',
      a: 'Yes — open Notions and tap “Copy shopping list”. The fabric for your size goes first (choose your size ' +
        'in Size & alterations), then everything you have not ticked off, then thread unless the pattern lists it. ' +
        'The Fabric / Notions / Thread switches above the button choose what goes on it.'
    },
    {
      q: 'Can I see the diagrams from the booklet?',
      a: 'Yes — when you import the PDF, “Show each step’s own drawing beside it” and “Keep the pages so you can ' +
        'see the diagrams” are ticked (untick them to save space). ' +
        'Each page is saved as a picture on your phone, the step card grows a 📄 page chip that opens ' +
        'the right page, and ⋯ → Pages shows them all. They are saved with the project and go into a .thready backup (Back up now); ' +
        'a plain .json backup leaves them out, so keep the PDF too. Untick both boxes and nothing is stored.'
    },
    {
      q: 'My pattern is a quilt. Where are the block counters?',
      a: 'When the importer knows which step makes a unit (“Make 4 Unit 7a”), the big button counts that unit on its ' +
        'step: tap it for each one you make, −1 takes one off, and “✓ Step done” under it moves on. Units the ' +
        'importer could not place in a step still get their own counter card above the step card.'
    },
    {
      q: 'Can I sew hands-free?',
      a: 'Tap ⤢ Sewing mode under the big button. The step fills the screen with its drawing, set-up and the next ' +
        'step; tap the coloured space (not the text, which scrolls) or Next when it is done. A Bluetooth page-turner pedal (it sends arrow keys) or the arrow keys ' +
        'move forward and back. ✕ or Escape leaves it, and the app remembers it for this project.'
    },
    {
      q: 'The step text is wrong. Can I fix it?',
      a: 'Yes. In the step list tap ✂ beside the step, then “Edit the text” or “Add a note”. Your wording and notes ' +
        'are kept when you import the same pattern again.'
    }
  ];

  /**
   * Started from Settings the user is on the home screen, where none of this
   * tour's targets exist — every step would be dropped and the tour would mark
   * itself seen without ever showing a card. Open a sewing project first.
   * @returns {boolean} true when a sewing project is on screen
   */
  function openASewingProject() {
    try {
      if (C && typeof C.closeAllSheets === 'function') C.closeAllSheets();
      var all = Store.projects() || [];
      var open = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i].craft !== 'sewing') continue;
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

  var TOUR = {
    id: 'sewing',
    title: 'Sewing a pattern',
    blurb: 'The step card, the cutting list and the shopping list.',
    steps: function () {
      return [
        {
          target: '#sw-step-btn',
          before: function () { openASewingProject(); },
          fallback: 'center',
          title: 'One step at a time',
          body: 'The card above shows the step you are on. When you have done it, tap this big button and the ' +
            'card moves on. Your place is saved, so you can walk away for a month and come back to it.',
          tryIt: 'tap Step done.',
          fallbackTitle: 'Start a sewing project first',
          fallbackBody: 'This one walks around the sewing screen, so it needs a pattern to point at. ' +
            'Tap ＋ New, choose Sewing, then come back to this tour.'
        },
        {
          target: '.sw-work-open',
          title: 'Sewing mode',
          body: 'Makes the step the whole screen: big text, the step’s own drawing, its seam allowance and foot, ' +
            'and what comes next. Tap the coloured space or Next when the step is done (the text only scrolls); a page-turner pedal or the arrow keys move ' +
            'between steps, so your hands stay on the fabric. The app remembers it for this project.'
        },
        {
          target: '.sw-fig',
          title: 'The step’s own drawing',
          body: 'When the importer could cut this step’s drawing cleanly out of the booklet, it sits right under ' +
            'the step. Tap it to see the whole page. If it could not, the page chip opens the page with the step outlined.'
        },
        {
          target: '.sw-progress',
          title: 'Where you are',
          body: 'This strip shows how far through you are. Tap it for the whole list, to tick something off ' +
            'out of order, or to jump back to a step.'
        },
        {
          target: '.sw-step-meta',
          title: 'Page and seam allowance',
          body: 'The page chip tells you which page of the booklet this step came from, and the seam allowance ' +
            'the pattern stated is always right there. Tap it to see any exceptions.'
        },
        {
          target: '.sw-mini-cut',
          title: 'Cutting',
          body: 'Every piece the pattern asks you to cut, counted as you cut it. On a cutting step a bar of ' +
            'the pieces sits above the step and fills in as you go. ⋯ → Cutting board groups them by fabric.'
        },
        {
          target: '.sw-mini-cut',
          title: 'The cutting list',
          body: 'Every piece the pattern asks you to cut, grouped by fabric. Tap the “0 of 2 cut” chip as you cut ' +
            'each one — no forgetting whether you already cut the second sleeve.'
        },
        {
          target: '.sw-mini-notions',
          title: 'Notions and the shopping list',
          body: 'Tick off what you already have. “Copy shopping list” puts everything else on your clipboard ' +
            'for the fabric shop.'
        },
        {
          target: '.sw-mini-size',
          title: 'Size and alterations',
          body: 'Type your measurements once (every project shares them) and the app suggests a size, quoting the ' +
            'pattern’s own rule for between sizes. Tap Use to choose it: from then on the step card, fabric and ' +
            'elastic lengths show your size’s numbers only. A number the app could not read for sure is marked “?”.'
        }
      ];
    }
  };

  /* ---- the craft definition ---- */

  App.registerCraft({
    id: 'sewing',
    name: 'Sewing',
    emoji: '🪡',
    tagline: 'Follow a pattern from PDF to finished make.',

    renderProject: function (project, main, ctx) {
      C = ctx;
      if (!view || viewProjectId !== project.id || !main.contains(view.progress)) {
        ctx.clear(main);
        viewProjectId = project.id;
        view = buildView(main);
      }
      paint(project);
    },

    destroyProject: function () {
      clearUnitTimers();
      view = null;
      viewProjectId = null;
      dropFigUrls();
    },

    // P2: the step as the whole screen (shell-ui §1).
    workMode: WORK_SPEC,
    // Share a picture (shell-ui §3).
    sharePicture: sharePicture,
    copy: {
      dropLabel: 'Drop the sewing pattern PDF (the instructions booklet) here, or choose a file',
      importEmpty: 'No steps found yet: import the instructions from the ⋯ menu.'
    },

    menuItems: menuItems,
    openImportSheet: openImportSheet,
    newProjectFields: newProjectFields,
    summary: function (project) { return S.summary(project); },

    onInit: function (ctx) {
      C = C || ctx;
      if (typeof ctx.addFaq === 'function') {
        FAQ.forEach(function (entry) {
          try { ctx.addFaq(entry); } catch (e) { /* ignore */ }
        });
      }
      if (window.Tour && typeof window.Tour.register === 'function') {
        try { window.Tour.register(TOUR); } catch (e) { /* ignore */ }
      }
    }
  });

  /* ================================================================== *
   * 7. window.SewingApp (docs/wave-k/api/sew-app.md)
   * ================================================================== */

  function projOf(x) {
    if (x && typeof x === 'object' && x.id) return Store.project(x.id) || x;
    if (typeof x === 'string') return Store.project(x);
    return viewProjectId ? Store.project(viewProjectId) : null;
  }

  var SHEETS = {
    steps: function (id) { openStepsSheet(id); },
    cutting: function (id) { openCuttingSheet(id); },
    notions: function (id) { openNotionsSheet(id); },
    size: function (id) { openSizeSheet(id); },
    fabric: function (id) {
      var pr = Store.project(id), x = pr && extrasFind(pr, /^fabric$/);
      if (!(x && extrasOpen(x.id, pr, {}))) openFabricSheet(id);
    },
    machine: function (id) { openMachineSheet(id); },
    seam: function (id) { openSeamSheet(id); },
    pages: function (id) { openPagesSheet(id); },
    page: function (id, o) { openPageViewer(id, o && o.page, o && o.outline); },
    sheet: function (id) { openSheetView(id); },
    addSheet: function (id) { openAddSheet(id); },
    import: function (id) { openImportSheet(id); }
  };

  function stateOf(p) {
    var d = dataOf(p);
    var total = d.steps.length;
    var at = total ? Math.min(d.currentStep, total - 1) : 0;
    var st = total ? d.steps[at] : null;
    var ps = S.printedSteps(d.steps);
    var au = activeUnitOf(d);
    var ref = figureRef(st);
    var setup = setupOf(st, d);
    return {
      at: at, where: total ? stepWhere(d, at) : 'No steps', total: ps.total || total,
      done: ps.total ? S.printedDone(d.steps, ps) : stepsDone(d),
      size: d.size.chosen || '',
      unitBtn: au ? { name: au.unit.name, done: au.unit.done, target: au.unit.target } : null,
      figure: ref ? ref.kind : 'none',
      chips: setup && setup.chips ? setup.chips.map(function (c) { return c.label; }) : []
    };
  }

  // The extras sheets announce their writes; the step screen repaints itself.
  // repaint() and the event both land here, so one extras write paints once.
  var paintTimer = null;
  function schedulePaint(pid) {
    if (paintTimer) return;
    paintTimer = window.setTimeout(function () {
      paintTimer = null;
      var id = pid || viewProjectId;
      var pr = id ? Store.project(id) : null;
      if (pr && view && viewProjectId === pr.id) paint(pr);
      else if (C && typeof C.render === 'function') { try { C.render(); } catch (e) { /* ignore */ } }
      refreshWork();
    }, 0);
  }
  try {
    document.addEventListener('sewingextras:change', function (e) {
      var pid = e && e.detail && e.detail.projectId;
      if (pid && pid === viewProjectId) schedulePaint(pid);
    });
  } catch (e) { /* ignore */ }

  /* ---- for sew-extras: the quilt top model and the booklet's swatches, kept at import ---- */
  var lastFiles = {};    // projectId → the PDF File of this session's import (never stored)

  function putJSON(key, obj) {
    if (!blobsAvailable()) return Promise.resolve(false);
    try {
      return window.BlobStore.put(key, new Blob([JSON.stringify(obj)], { type: 'application/json' }));
    } catch (e) { return Promise.resolve(false); }
  }
  function getJSON(key) {
    if (!blobsAvailable()) return Promise.resolve(null);
    var B = window.BlobStore;
    var read = typeof B.getText === 'function' ? B.getText(key) : B.get(key).then(function (b) {
      return b && b.text ? b.text() : null;
    });
    return Promise.resolve(read).then(function (t) {
      try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
    }, function () { return null; });
  }

  /**
   * With the PDF open once: the quilt layout (SewQuilt, vector when its shapes read, else the
   * page as a picture) at p:<id>:quiltmodel, and the swatches the booklet prints, captured
   * cleanly only (SewFigures), at p:<id>:swatch:<i> with their list at p:<id>:swatchinfo.
   */
  function captureImportExtras(projectId, file) {
    var F = window.SewFigures, Q = window.SewQuilt;
    file = file || lastFiles[projectId];
    if (!file || !F || typeof F.readPages !== 'function' || !blobsAvailable() || !window.PdfText || !window.PdfText.isAvailable()) {
      return Promise.resolve(null);
    }
    var p = Store.project(projectId);
    if (!p) return Promise.resolve(null);
    var d = dataOf(p);
    var out = { quilt: null, swatches: null };
    var h = null;
    return window.PdfText.open(file).then(function (handle) {
      h = handle;
      var n = Math.min(handle.numPages || 0, MAX_PAGES);
      var chain = Promise.resolve();
      // Swatches: the requirement pages (the first few) and the pages the fabric rows sit near.
      if (d.fabric.length && typeof F.swatches === 'function' && typeof F.captureSwatches === 'function') {
        var want = [];
        for (var i = 1; i <= Math.min(n, 4); i++) want.push(i);
        chain = chain.then(function () { return F.readPages(handle, want, {}); }).then(function (infos) {
          var sw = F.swatches(d.fabric, infos || {}, {}) || [];
          var clean = sw.filter(function (s) { return s && s.clean && s.rect; });
          if (!clean.length) return null;
          return F.captureSwatches(projectId, clean, { handle: handle }, {}).then(function (bits) {
            var list = (bits || []).filter(function (b) { return b && b.clean !== false && b.blobKey; });
            out.swatches = list;
            return putJSON('p:' + projectId + ':swatchinfo', { at: Date.now(), swatches: list });
          });
        });
      }
      // The quilt top: the layout page the text names, read as shapes.
      if (Q && d.kind === 'quilt' && S.quiltTop && typeof Q.fromShapes === 'function') {
        chain = chain.then(function () {
          var top = null;
          try { top = S.quiltTop(d); } catch (e) { top = null; }
          var pg = top && typeof top.layoutPage === 'number' ? top.layoutPage : null;
          if (!pg || pg > n) return null;
          return F.readPages(handle, [pg], { shapes: true }).then(function (infos) {
            var info = infos && infos[pg];
            if (!info) return null;
            var model = null;
            try { model = Q.fromShapes(info, d.fabric, {}); } catch (e) { model = null; }
            if (!model && typeof Q.pictureModel === 'function') {
              try { model = Q.pictureModel(pg, { x0: 0, y0: 0, x1: 1, y1: 1 }, 'The layout on page ' + pg + ' is a picture.'); } catch (e) { model = null; }
            }
            if (!model) return null;
            out.quilt = model;
            return putJSON('p:' + projectId + ':quiltmodel', model);
          });
        });
      }
      return chain;
    }).then(function () {
      if (h && h.destroy) { try { h.destroy(); } catch (e) { /* ignore */ } }
      if (out.quilt || out.swatches) schedulePaint(projectId);
      try { document.dispatchEvent(new CustomEvent('sewingapp:captured', { detail: { projectId: projectId, quilt: !!out.quilt, swatches: out.swatches ? out.swatches.length : 0 } })); } catch (e) { /* ignore */ }
      return out;
    }, function () {
      if (h && h.destroy) { try { h.destroy(); } catch (e) { /* ignore */ } }
      return out;
    });
  }

  /** The kept quilt model, with the page picture for picture mode. */
  function quiltModelOf(projectId) {
    return getJSON('p:' + projectId + ':quiltmodel').then(function (model) {
      if (!model) return null;
      var p = Store.project(projectId);
      var row = p ? pageRow(dataOf(p), model.page) : null;
      if (!row || !blobsAvailable()) return { model: model, image: null };
      return window.BlobStore.get(row.blobKey).then(function (blob) {
        if (!blob) return { model: model, image: null };
        return new Promise(function (resolve) {
          var url = URL.createObjectURL(blob);
          var im = new Image();
          im.onload = function () { resolve({ model: model, image: im, revoke: function () { URL.revokeObjectURL(url); } }); };
          im.onerror = function () { URL.revokeObjectURL(url); resolve({ model: model, image: null }); };
          im.src = url;
        });
      }, function () { return { model: model, image: null }; });
    });
  }

  window.SewingApp = {
    version: '1.0.0',
    currentProject: function () {
      var p = viewProjectId ? Store.project(viewProjectId) : null;
      return p && p.craft === 'sewing' ? p : null;
    },
    size: function (p) { p = projOf(p); return p ? dataOf(p).size.chosen || '' : ''; },
    units: function (p) { p = projOf(p); return p ? unitsOf(dataOf(p)) : profileUnit(); },
    // sew-extras' contract: the step index (docs/wave-k/api/sew-extras.md).
    currentStep: function (p) {
      p = projOf(p);
      if (!p) return 0;
      var d = dataOf(p);
      return d.steps.length ? Math.min(d.currentStep, d.steps.length - 1) : 0;
    },
    chosenSize: function (p) { p = projOf(p); return p ? dataOf(p).size.chosen || '' : ''; },
    dataOf: function (p) { p = projOf(p); return p ? dataOf(p) : null; },
    stepInfo: function (p) {
      p = projOf(p);
      if (!p) return null;
      var d = dataOf(p);
      if (!d.steps.length) return null;
      var at = Math.min(d.currentStep, d.steps.length - 1);
      return { index: at, step: d.steps[at], where: stepWhere(d, at), setup: setupOf(d.steps[at], d),
        units: unitsInStep(d, at), activeUnit: activeUnitOf(d) };
    },
    repaint: function (id) {
      var p = projOf(id);
      schedulePaint(p ? p.id : null);
    },
    /** sew-extras: the quilt top model kept at import → Promise<{ model, image } | null>. */
    quiltModel: function (id) {
      var p = projOf(id);
      return p ? quiltModelOf(p.id) : Promise.resolve(null);
    },
    /**
     * sew-extras: the booklet's swatches → Promise<[SwatchBitmap]> (blobs p:<id>:swatch:<i>).
     * Captures them now when this session still holds the imported PDF, else returns the kept list.
     */
    captureSwatches: function (id) {
      var p = projOf(id);
      if (!p) return Promise.resolve([]);
      return getJSON('p:' + p.id + ':swatchinfo').then(function (kept) {
        if (kept && kept.swatches && kept.swatches.length) return kept.swatches;
        if (!lastFiles[p.id]) return [];
        return captureImportExtras(p.id).then(function (o) { return (o && o.swatches) || []; });
      });
    },
    openSheet: function (id, projectId, opts) {
      var p = projOf(projectId);
      if (!p || !SHEETS[id] || !C) return false;
      SHEETS[id](p.id, opts || {});
      return true;
    },
    vocab: function (p) { p = projOf(p); return vocabOf(p ? dataOf(p) : { kind: 'unknown' }); },
    /** sew-extras' fabric sheet: the rows as printed, the nap sentences and "What I actually used". */
    fabricOwnParts: function (node, id) {
      var p = projOf(id);
      if (p && node && C) fabricOwnParts(p.id, node, { embedded: true });
    },
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      changeListeners.push(fn);
      return function () {
        var i = changeListeners.indexOf(fn);
        if (i >= 0) changeListeners.splice(i, 1);
      };
    },
    __test: {
      state: function (id) { var p = projOf(id); return p ? stateOf(p) : null; },
      advance: function (id) { advance(id); },
      stepDone: function (id) { stepDone(id); },
      unitBump: function (id, delta) {
        var p = projOf(id);
        var au = p ? activeUnitOf(dataOf(p)) : null;
        if (au) bumpUnit(p.id, au.unit.id, delta || 1);
      },
      readout: function (id) {
        var p = projOf(id);
        return p ? WORK_SPEC.readout({ project: function () { return p; }, surface: null }) : null;
      },
      advice: function (id, mine) {
        var p = projOf(id);
        if (!p) return null;
        var d = dataOf(p), chart = chartOf(d);
        if (mine && S.suggestSize) return S.suggestSize(chart || d, mine, { rule: S.sizeRule ? S.sizeRule(d.sourceText || '') : null });
        return adviceFor(d, chart, unitsOf(d, chart));
      },
      chooseSize: function (id, size) { var p = projOf(id); if (p) chooseSize(p.id, size); },
      resolved: function (id) { var p = projOf(id); return p ? resolvedFor(p, dataOf(p)) : null; },
      menu: function (p) { p = projOf(p); return p ? menuItems(p).map(function (it) { return { icon: it.icon, label: it.label }; }) : []; },
      figureRef: figureRef,
      rectRef: rectRef,
      importCheck: function (parse, opts) { return S.importCheck ? S.importCheck(parse, opts || {}) : null; },
      milestones: function (before, after) { return S.milestones ? milestoneLabels(S.milestones(before, after)) : []; },
      captureFigures: captureFigures,
      renameFromPattern: renameFromPattern,
      patternName: patternNameOf,
      saLabel: function (id) { var p = projOf(id); return p ? saLabel(dataOf(p)) : ''; }
    }
  };

})();
