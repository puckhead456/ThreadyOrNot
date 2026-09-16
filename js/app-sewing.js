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

  /** The one door this module writes project state through. */
  function edit(projectId, fn) {
    return Store.updateCraftData(projectId, function (raw, proj) {
      var d = S.normalize(raw, proj);
      fn(d, proj);
      return d;
    });
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
  function notionsDone(d) {
    var n = 0;
    for (var i = 0; i < d.notions.length; i++) if (d.notions[i].have) n++;
    return n;
  }
  function stepsDone(d) {
    var n = 0;
    for (var i = 0; i < d.steps.length; i++) if (d.steps[i].done) n++;
    return n;
  }

  /** 'SA 1.5 cm (5/8")' for the step meta line, or ''. */
  function saLabel(d) {
    var sa = d.seamAllowance;
    if (!sa) return '';
    var bits = [];
    if (typeof sa.mm === 'number') {
      bits.push(sa.mm >= 10 ? (sa.mm / 10) + ' cm' : sa.mm + ' mm');
    }
    if (sa.inches) bits.push('(' + sa.inches + '")');
    if (!bits.length) return sa.included === true ? 'SA included' : '';
    return 'SA ' + bits.join(' ') + (sa.exceptions && sa.exceptions.length ? ' +' + sa.exceptions.length : '');
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
    head.appendChild(v.stepSection);
    v.stepText = el('div', 'sw-step-text');
    v.card.appendChild(head);
    v.card.appendChild(v.stepText);
    main.appendChild(v.card);

    // --- step meta ----------------------------------------------------------
    v.meta = el('div', 'sw-step-meta');
    v.page = button('chip sw-page', null, 'Page');
    on(v.page, 'click', function () {
      if (typeof view.pageNo === 'number') openPageViewer(viewProjectId, view.pageNo);
    });
    v.sa = button('sw-sa', null, 'Seam allowance');
    on(v.sa, 'click', function () { openSeamSheet(viewProjectId); });
    v.meta.appendChild(v.page);
    v.meta.appendChild(v.sa);
    main.appendChild(v.meta);

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

    v.back = button('linkish sw-back', '↺ back a step', 'Undo the last step');
    on(v.back, 'click', function () {
      if (Store.undo()) {
        C.fb('undo');
        C.toast('Back a step');
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
    var done = stepsDone(d);
    var pct = total ? Math.round((done / total) * 100) : 0;

    view.progressFill.style.width = pct + '%';
    view.progressLabel.textContent = total
      ? 'Step ' + (at + 1) + ' of ' + total + ' · ' + pct + '%'
      : 'No steps yet — import or add some';
    view.progress.setAttribute('aria-label',
      total ? 'Step ' + (at + 1) + ' of ' + total + ', open the step list' : 'Add steps');

    var step = total ? d.steps[at] : null;
    view.stepN.textContent = total ? 'STEP' : 'NO STEPS';
    view.ring.set(at + 1, total);
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
    var sa = saLabel(d);
    view.sa.textContent = sa;
    view.sa.hidden = !sa;

    var isDone = total > 0 && done >= total;
    view.btn.disabled = !total;
    view.btnCaption.textContent = isDone ? 'ALL DONE' : 'STEP DONE';
    view.btnMark.textContent = isDone ? '🎉' : '✓';
    view.btnHint.textContent = !total
      ? 'add some steps first'
      : (isDone ? 'every step is ticked off' : 'tap when you have done it');
    view.back.hidden = !total;

    // mini rows
    var sizeBits = [];
    if (d.size.chosen) sizeBits.push('Size ' + d.size.chosen);
    if (d.size.alterations) sizeBits.push(clip(d.size.alterations, 40));
    view.miniSize.text.textContent = sizeBits.length ? sizeBits.join(' · ') : 'Pick your size and note alterations';
    view.miniCut.text.textContent = d.cutting.length
      ? cutDone(d) + ' of ' + d.cutting.length + ' pieces cut'
      : 'No cutting list yet';
    view.miniNotions.text.textContent = d.notions.length
      ? notionsDone(d) + ' of ' + d.notions.length + ' notions ready'
      : 'No notions list yet';

    if (view.awake && C.wake) {
      var awakeOn = !!C.wake.isOn();
      view.awake.classList.toggle('on', awakeOn);
      view.awake.setAttribute('aria-pressed', awakeOn ? 'true' : 'false');
    }

    paintCutTable(d);
    paintUnits(p, d);
  }

  function paintUnits(p, d) {
    var wrap = view.units;
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

    function bump(delta) {
      var reached = false;
      edit(p.id, function (d) {
        for (var i = 0; i < d.units.length; i++) {
          if (d.units[i].id !== unit.id) continue;
          var next = d.units[i].done + delta;
          if (next < 0) next = 0;
          if (d.units[i].target > 0 && next > d.units[i].target) next = d.units[i].target;
          reached = delta > 0 && d.units[i].target > 0 && next >= d.units[i].target && d.units[i].done < d.units[i].target;
          d.units[i].done = next;
        }
      });
      var fresh = Store.project(p.id);
      if (delta > 0) {
        var now = dataOf(fresh);
        var row = null;
        for (var j = 0; j < now.units.length; j++) if (now.units[j].id === unit.id) row = now.units[j];
        C.fb(row && row.done % 10 === 0 ? 'group' : 'tap');
        if (reached) { C.celebrate('piece'); C.toast(unit.name + ' all made ✓'); }
        if (row) C.announce(unit.name + ' ' + row.done + ' of ' + row.target);
      } else {
        C.fb('undo');
      }
      paint(fresh);
    }

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
    return card;
  }

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

  function advance() {
    var p = Store.project(viewProjectId);
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
    });

    var fresh = Store.project(p.id);
    var d = dataOf(fresh);
    var done = stepsDone(d);
    var total = d.steps.length;

    C.fb('row');
    paint(fresh);

    if (done >= total) {
      C.announce('All ' + total + ' steps done');
      C.celebrate('project');
      try { Store.setStatus(fresh.id, 'finished'); } catch (e) { /* ignore */ }
      C.toast('Every step is done 🎉 — marked finished');
      C.render();
      return;
    }

    C.announce('Step ' + (Math.min(d.currentStep, total - 1) + 1) + ' of ' + total);
    if (done > 0 && done % 10 === 0) {
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

  function openStepsSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var api = C.openSheet({
      title: 'Steps',
      cls: 'sheet-sewing',
      build: function (body) { renderSteps(body); }
    });

    function renderSteps(body) {
      C.clear(body);
      var proj = Store.project(projectId);
      if (!proj) { api.close(); return; }
      var d = dataOf(proj);
      body.appendChild(sheetHeadLine(
        d.steps.length ? stepsDone(d) + ' of ' + d.steps.length + ' done' : 'No steps yet.'
      ));

      var list = C.el('div', 'list sw-steps');
      var section = null;
      for (var i = 0; i < d.steps.length; i++) {
        var st = d.steps[i];
        if (st.section !== section) {
          section = st.section;
          if (section) list.appendChild(C.el('div', 'sw-section-head', section));
        }
        list.appendChild(stepRow(proj, d, st, i, renderSteps, body));
      }
      body.appendChild(list);

      var add = C.button('btn ghost block', '＋ Add step');
      C.on(add, 'click', function () {
        var input = C.textInput('', 'What do you do next?');
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
                  dd.steps.push({
                    id: 'sw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    n: dd.steps.length + 1, section: '', text: text, done: false, page: null, imageRef: null
                  });
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
  }

  function stepRow(proj, d, st, index, rerender, body) {
    var row = C.el('div', 'list-item sw-step-row' + (st.done ? ' done' : '') + (index === d.currentStep ? ' current' : ''));
    var check = C.button('check', '✓', (st.done ? 'Mark step ' + (index + 1) + ' not done' : 'Mark step ' + (index + 1) + ' done'));
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', st.done ? 'true' : 'false');
    C.on(check, 'click', function () {
      edit(proj.id, function (dd) {
        if (dd.steps[index]) dd.steps[index].done = !dd.steps[index].done;
      });
      C.fb('tap');
      rerender(body);
      paint(Store.project(proj.id));
    });

    var textBtn = C.button('item-text sw-step-jump', null, 'Jump to step ' + (index + 1));
    textBtn.appendChild(C.el('span', 'sw-step-row-n', (index + 1) + '.'));
    textBtn.appendChild(C.el('span', 'sw-step-row-text', clip(st.text, 70)));
    C.on(textBtn, 'click', function () {
      jumpToStep(proj.id, index, function () { rerender(body); });
    });

    row.appendChild(check);
    row.appendChild(textBtn);
    if (typeof st.page === 'number') {
      row.appendChild(C.el('span', 'chip sw-page-chip', 'p' + st.page));
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
      C.announce('Step ' + (index + 1) + ' of ' + d.steps.length);
      if (after) after();
    }

    if (backwards && anyDoneAfter) {
      C.confirmSheet({
        title: 'Go back to step ' + (index + 1) + '?',
        message: 'Steps you have already ticked off stay ticked — this only moves where you are.',
        confirmText: 'Go back'
      }).then(function (ok) { if (ok) go(); });
      return;
    }
    go();
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
      body.appendChild(sheetHeadLine(
        d.cutting.length ? cutDone(d) + ' of ' + d.cutting.length + ' pieces cut' : 'No pieces yet.'
      ));

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

  function cutRowNode(proj, row, index, body, rerender) {
    var node = C.el('div', 'list-item sw-cut-row' + (row.cutCount >= row.qty ? ' done' : ''));
    var chip = C.button('chip sw-count-chip', row.cutCount + '/' + row.qty,
      row.piece + ', ' + row.cutCount + ' of ' + row.qty + ' cut, tap to count');
    C.on(chip, 'click', function () {
      edit(proj.id, function (dd) {
        var r = dd.cutting[index];
        if (!r) return;
        r.cutCount = r.cutCount >= r.qty ? 0 : r.cutCount + 1;
      });
      C.fb('tap');
      rerender(body);
      afterCut(proj.id);
    });

    var mid = C.button('item-text sw-cut-text', null, 'Edit ' + row.piece);
    mid.appendChild(C.el('span', 'sw-cut-name', row.piece));
    var sub = [];
    if (row.dims) sub.push(row.dims);
    if (row.grain) sub.push(row.grain);
    if (row.note) sub.push(row.note);
    if (sub.length) mid.appendChild(C.el('span', 'sw-cut-sub', sub.join(' · ')));
    C.on(mid, 'click', function () { openCutEditor(proj.id, index, function () { rerender(body); }); });

    node.appendChild(chip);
    node.appendChild(mid);
    if (row.onFold) node.appendChild(C.el('span', 'pill sw-fold', 'on fold'));
    return node;
  }

  function afterCut(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    paint(p);
    if (d.cutting.length && cutDone(d) >= d.cutting.length) {
      C.celebrate('piece');
      C.toast('Everything\'s cut ✂️');
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
    var dims = C.textInput(row.dims, '14" x 16"');
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

      var input = C.textInput('', 'Add a notion');
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

      var copy = C.button('btn primary block', '📋 Copy shopping list');
      C.on(copy, 'click', function () { copyShoppingList(projectId); });
      copy.disabled = !d.notions.length;
      body.appendChild(copy);
      body.appendChild(C.el('p', 'field-hint', 'Copies everything you have not ticked off, ready for the fabric shop.'));
    }
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
    var lines = [];
    for (var i = 0; i < d.notions.length; i++) if (!d.notions[i].have) lines.push('• ' + d.notions[i].text);
    if (!lines.length) { C.toast('You already have everything ✓'); return; }
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
        b.appendChild(C.el('p', 'sw-sa-big', saLabel(d).replace(/^SA /, '')));
        if (d.seamAllowance.text) b.appendChild(C.el('p', 'muted', d.seamAllowance.text));
        if (d.seamAllowance.included !== null) {
          b.appendChild(C.el('p', 'muted', d.seamAllowance.included
            ? 'Seam allowances are included in the pieces.'
            : 'Seam allowances are NOT included — add them as you cut.'));
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
    var api = C.openSheet({
      title: 'Size & alterations',
      cls: 'sheet-sewing',
      build: function (body) { renderSize(body); }
    });

    var which = 'body';

    function renderSize(body) {
      C.clear(body);
      var proj = Store.project(projectId);
      if (!proj) { api.close(); return; }
      var d = dataOf(proj);

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
      labels.forEach(function (label) {
        var input = C.textInput(mine[label] || '', '96 cm');
        input.setAttribute('aria-label', 'My ' + label);
        C.on(input, 'change', function () {
          var bag = settings().measurements;
          if (!bag || typeof bag !== 'object') bag = {};
          bag[label] = input.value.replace(/^\s+|\s+$/g, '');
          setSetting('measurements', bag);
        });
        body.appendChild(C.field(label, input));
      });

      // alterations
      var alt = C.textArea(d.size.alterations, 'sw-alt', 'FBA 2.5 cm, lengthened bodice 3 cm, sway back 1 cm…');
      alt.setAttribute('aria-label', 'Alterations');
      C.on(alt, 'change', function () {
        edit(projectId, function (dd) { dd.size.alterations = alt.value; });
        paint(Store.project(projectId));
      });
      body.appendChild(C.field('Alterations', alt, 'What you changed, so next time you remember.'));
    }
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
    var d = dataOf(p);
    C.openSheet({
      title: 'Fabric',
      cls: 'sheet-sewing',
      build: function (b) {
        if (!d.fabric.length) {
          b.appendChild(C.el('p', 'muted', 'No fabric requirements were found in the pattern.'));
        } else {
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
            } else if (row.line) {
              card.appendChild(C.el('div', 'muted sw-fabric-raw', row.line));
            }
            b.appendChild(card);
          });
        }
        // SewingData has no field for this, and normalize() drops unknown keys,
        // so it lives in the project's own notes behind a small tag.
        var used = C.textArea(fabricUsedFrom(p), 'sw-alt', 'What you actually used, and where it came from');
        used.setAttribute('aria-label', 'What I actually used');
        C.on(used, 'change', function () {
          var proj = Store.project(projectId);
          if (!proj) return;
          Store.updateProject(projectId, { notes: notesWithFabric(proj, used.value) });
          C.toast('Saved to the project notes');
        });
        b.appendChild(C.field('What I actually used', used, 'Saved into the project notes.'));
      },
      footer: [{ text: 'Done', cls: 'btn primary', onClick: function (a) { a.close(); } }]
    });
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

  var STORED_HERE = 'Pages are stored on this device only — keep the PDF.';

  /**
   * Rasterise the PDF's pages into BlobStore, one at a time so a 40-page
   * booklet never blocks the main thread for long. Resolves with the rows for
   * `craftData.pages` plus the total byte count (used for the toast).
   */
  function renderPageImages(projectId, handle, onProgress, isCancelled) {
    var total = Math.min((handle && handle.numPages) || 0, MAX_PAGES);
    if (!total || !blobsAvailable() || typeof handle.renderPage !== 'function') {
      return Promise.resolve({ pages: [], bytes: 0, total: 0 });
    }
    var pages = [];
    var bytes = 0;
    // A re-render replaces what was there, so clear the old blobs first.
    var chain = window.BlobStore.deletePrefix(pagePrefix(projectId)).then(null, function () { /* ignore */ });

    function step(n) {
      return function () {
        if (isCancelled && isCancelled()) return null;
        if (onProgress) onProgress(n, total);
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
    for (var n = 1; n <= total; n++) chain = chain.then(step(n));

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
  function openPageViewer(projectId, pageNo) {
    var proj = Store.project(projectId);
    if (!proj) return;
    var d = dataOf(proj);
    if (!d.pages.length) { C.toast('No page images yet'); return; }

    var stepPage = typeof pageNo === 'number' ? pageNo : d.pages[0].n;
    var idx = 0;
    for (var i = 0; i < d.pages.length; i++) if (d.pages[i].n === stepPage) idx = i;

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
          STORED_HERE + ' They are not in your backup file.' +
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
    host.setAttribute('aria-label',
      cutDone(d) + ' of ' + d.cutting.length + ' pieces cut — open the cutting list');
  }

  /* ================================================================== *
   * 5. The import sheet
   * ================================================================== */

  var GROUPS = [
    { id: 'steps', label: 'Steps', count: function (pr) { return pr.steps.length; }, note: function (pr) {
      if (!pr.steps.length) return '';
      var m = pr.steps[0].marker;
      return m === 'Step' ? '(Step N style)' : (m === '1)' ? '(1) style)' : (m === 'none' ? '(from paragraphs)' : '(1. style)'));
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
      return pr.fabric.length ? '(' + plural(pr.fabric.length, 'width') + ')' : '';
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
    var wantPages = false;
    var pageHandle = null;
    var cancelled = false;

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
            takeText(res.text, res.columnsDetected);
          },
          onError: function () {
            C.toast('Couldn’t read that PDF (it may be scanned images)', { ms: 4200 });
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
        { text: 'Import', cls: 'btn primary', onClick: function (a) { if (applyImport(false, a)) a.close(); } }
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
    }

    function takeText(text, columns) {
      if (!text || !text.replace(/\s/g, '')) {
        C.toast('There was no text in that file');
        return;
      }
      if (text.replace(/\s/g, '').length < 200) {
        C.toast('That looks like scanned images — there is no text to read', { ms: 4200 });
        return;
      }
      try {
        parsed = S.parse(text, { columns: columns || 0 });
      } catch (e) {
        parsed = null;
        C.toast('That pattern could not be read');
        return;
      }
      checks = {};
      GROUPS.forEach(function (g) { checks[g.id] = g.count(parsed) > 0; });
      renderReview();
      syncFooter();
    }

    function renderReview() {
      C.clear(reviewWrap);
      if (!parsed) return;
      reviewWrap.appendChild(C.el('div', 'sw-group-head', 'What was found'));
      var list = C.el('div', 'list sw-review-list');
      GROUPS.forEach(function (g) {
        var n = g.count(parsed);
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

      reviewWrap.appendChild(list);

      if (parsed.warnings.length) {
        var warn = C.el('div', 'sw-warnings');
        parsed.warnings.forEach(function (w) { warn.appendChild(C.el('div', 'sw-warning', '⚠ ' + w)); });
        reviewWrap.appendChild(warn);
      }
    }

    function openGroupPreview(g) {
      var rows = [];
      if (g.id === 'steps') rows = parsed.steps.map(function (s, i) { return (i + 1) + '. ' + clip(s.text, 90); });
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
      C.render();

      if (textOnly) {
        C.toast('Kept the text — nothing else changed');
        return true;
      }
      var bits = [];
      if (groups.steps && parsed.steps.length) bits.push(plural(parsed.steps.length, 'step'));
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

      window.PdfText.open(pdfFile).then(function (handle) {
        pageHandle = handle;
        return renderPageImages(projectId, handle, function (n, total) {
          line.textContent = 'Rendering page ' + n + ' of ' + total + '…';
          fill.style.width = Math.round(((n - 1) / total) * 100) + '%';
        }, function () { return cancelled; });
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

  function menuItems(p) {
    var items = [];
    if (dataOf(p).pages.length) {
      items.push({ icon: '📄', label: 'Pages', run: function () { openPagesSheet(p.id); } });
    }
    return items.concat([
      { icon: '📏', label: 'Size & alterations', run: function () { openSizeSheet(p.id); } },
      { icon: '🧺', label: 'Fabric', run: function () { openFabricSheet(p.id); } },
      { icon: '⚙️', label: 'Machine settings', run: function () { openMachineSheet(p.id); } }
    ]);
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
      a: 'Tap the little 0/2 chip each time you cut one of that piece. It counts up and starts again at zero ' +
        'when you pass the total, the same way the crochet piece counter works.'
    },
    {
      q: 'Can I take the notions list to the shop?',
      a: 'Yes — open Notions and tap “Copy shopping list”. Everything you have not ticked off goes on your ' +
        'clipboard, ready to paste into a note or a message.'
    },
    {
      q: 'Can I see the diagrams from the booklet?',
      a: 'Yes — when you import the PDF, tick “Keep the pages so you can see the diagrams”. ' +
        'Each page is saved as a picture on your phone, the step card grows a 📄 page chip that opens ' +
        'the right page, and ⋯ → Pages shows them all. They are stored on this device only and are ' +
        'not in your backup, so keep the PDF. Leave the box unticked and nothing is stored.'
    },
    {
      q: 'My pattern is a quilt. Where are the block counters?',
      a: 'When the importer spots something like “224 flying geese” it adds a counter card above the step card. ' +
        'Tap it to add one, press and hold to take one off.'
    }
  ];

  var TOUR = {
    id: 'sewing',
    title: 'Sewing a pattern',
    blurb: 'The step card, the cutting list and the shopping list.',
    steps: function () {
      return [
        {
          target: '#sw-step-btn',
          title: 'One step at a time',
          body: 'The card above shows the step you are on. When you have done it, tap this big button and the ' +
            'card moves on. Your place is saved, so you can walk away for a month and come back to it.',
          tryIt: 'Try it: tap Step done'
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
          target: '.sw-cuttable',
          title: 'The cutting table',
          body: 'One block per piece the pattern asks you to cut, as wide as the number you need. ' +
            'They fill in as you cut, so you can see at a glance what is still on the table. Tap it ' +
            'for the whole cutting list.'
        },
        {
          target: '.sw-mini-cut',
          title: 'The cutting list',
          body: 'Every piece the pattern asks you to cut, grouped by fabric. Tap the little 0/2 chip as you cut ' +
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
          body: 'Pick your size from the chart, fill in your own measurements once, and write down what you ' +
            'altered. Next time you sew this pattern it is all still here.'
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

})();
