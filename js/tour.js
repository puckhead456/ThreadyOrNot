/* Thready or Not — js/tour.js
 * window.Tour : a spotlight walkthrough engine + the four guided tours.
 *
 * No dependencies beyond window.Store (for the `toursSeen` flag) and a few
 * opt-in hooks on window.App (open this sheet, re-render). Everything is
 * defensive: if App is not there yet the tours simply do less.
 *
 * The overlay dims the page with a cut-out (four panels around the target
 * rect) so the target stays visible AND clickable, draws an accent ring
 * around it and parks a card next to it. When a <dialog> sheet is open the
 * overlay is appended INSIDE that dialog, which is the only way to paint
 * above the browser's top layer while leaving the page underneath usable.
 */
(function () {
  'use strict';

  /* ================================================================== *
   * 1. Helpers
   * ================================================================== */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function button(cls, text) {
    var b = el('button', cls, text);
    b.type = 'button';
    return b;
  }

  function on(node, type, fn, opts) {
    if (node) node.addEventListener(type, fn, opts);
  }

  function off(node, type, fn, opts) {
    if (node) node.removeEventListener(type, fn, opts);
  }

  function reducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function settings() {
    try {
      return window.Store.settings() || {};
    } catch (e) {
      return {};
    }
  }

  function app(method) {
    return window.App && typeof window.App[method] === 'function' ? window.App[method] : null;
  }

  function rerender() {
    var fn = app('render');
    if (fn) fn();
  }

  /**
   * Wait for the next paint. rAF is suspended while the tab is hidden, so a
   * timer races it — otherwise a tour started in a background tab never moves.
   */
  function frame() {
    return new Promise(function (resolve) {
      var settled = false;
      function fire() {
        if (settled) return;
        settled = true;
        resolve();
      }
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(fire);
      });
      window.setTimeout(fire, 50);
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  /** An element only counts as a target when it is actually on screen. */
  function usable(node) {
    if (!node || !node.getBoundingClientRect) return null;
    // A disabled control is still worth pointing at, so only `hidden` counts.
    if (node.hidden) return null;
    var r = node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return node;
  }

  function resolveTarget(step) {
    if (!step || !step.target) return null;
    try {
      if (typeof step.target === 'function') return usable(step.target());
      // querySelectorAll, not querySelector: a selector can also match nodes in
      // a sheet that has already closed, and those are never the one we want.
      var all = document.querySelectorAll(step.target);
      for (var i = 0; i < all.length; i++) {
        var hit = usable(all[i]);
        if (hit) return hit;
      }
    } catch (e) {
      /* bad selector — treat as missing */
    }
    return null;
  }

  /** The topmost open <dialog>, or null. Tour UI has to live inside it. */
  function topDialog() {
    var open = document.querySelectorAll('dialog[open]');
    for (var i = open.length - 1; i >= 0; i--) {
      if (usable(open[i])) return open[i];
    }
    return null;
  }

  /* ================================================================== *
   * 2. Seen flags
   * ================================================================== */

  function seenList() {
    var s = settings().toursSeen;
    return Array.isArray(s) ? s.slice() : [];
  }

  function hasSeen(id) {
    return seenList().indexOf(id) !== -1;
  }

  function markSeen(id) {
    var list = seenList();
    if (list.indexOf(id) !== -1) return;
    list.push(id);
    try {
      window.Store.setSetting('toursSeen', list);
    } catch (e) {
      /* ignore */
    }
  }

  /* ================================================================== *
   * 3. Overlay UI
   * ================================================================== */

  var ui = null;

  function buildUI() {
    var root = el('div', 'tour-overlay');
    root.setAttribute('data-tour-ui', '');

    var panels = [];
    for (var i = 0; i < 4; i++) {
      var p = el('div', 'tour-dim');
      root.appendChild(p);
      panels.push(p);
    }

    var ring = el('div', 'tour-ring');
    root.appendChild(ring);

    var card = el('div', 'tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    card.tabIndex = -1;

    var counter = el('div', 'tour-count');
    var title = el('h3', 'tour-title');
    title.id = 'tour-card-title';
    card.setAttribute('aria-labelledby', title.id);
    var body = el('p', 'tour-body');
    var tryIt = el('p', 'tour-try');
    var extra = el('div', 'tour-extra');

    var foot = el('div', 'tour-foot');
    var skip = button('tour-skip', 'Skip');
    var spacer = el('span', 'tour-spacer');
    var back = button('btn ghost tour-nav', 'Back');
    var next = button('btn primary tour-nav', 'Next');
    foot.appendChild(skip);
    foot.appendChild(spacer);
    foot.appendChild(back);
    foot.appendChild(next);

    card.appendChild(counter);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(tryIt);
    card.appendChild(extra);
    card.appendChild(foot);
    root.appendChild(card);

    ui = {
      root: root,
      panels: panels,
      ring: ring,
      card: card,
      counter: counter,
      title: title,
      body: body,
      tryIt: tryIt,
      extra: extra,
      foot: foot,
      skip: skip,
      back: back,
      next: next
    };

    on(skip, 'click', function () { finish('skipped'); });
    on(back, 'click', function () { go(-1); });
    on(next, 'click', function () { go(1); });
    on(card, 'keydown', trapTab);
    return ui;
  }

  function ensureUI() {
    if (!ui) buildUI();
    var host = topDialog() || document.body;
    if (ui.root.parentNode !== host) host.appendChild(ui.root);
    return ui;
  }

  function destroyUI() {
    if (ui && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
  }

  function trapTab(e) {
    if (e.key !== 'Tab') return;
    var nodes = ui.card.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var list = Array.prototype.filter.call(nodes, function (n) { return usable(n); });
    if (!list.length) {
      e.preventDefault();
      ui.card.focus();
      return;
    }
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ui.card)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ================================================================== *
   * 4. Geometry
   * ================================================================== */

  var PAD = 8;      // breathing room around the spotlit element
  var MARGIN = 12;  // viewport margin for the card

  function layout(rect) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var p = ui.panels;

    if (!rect) {
      // No target: one full-screen dim, no ring.
      p[0].style.cssText = 'left:0;top:0;width:' + vw + 'px;height:' + vh + 'px';
      p[1].style.cssText = 'width:0;height:0';
      p[2].style.cssText = 'width:0;height:0';
      p[3].style.cssText = 'width:0;height:0';
      ui.ring.style.opacity = '0';
      ui.card.classList.add('centered');
      ui.card.style.left = '';
      ui.card.style.top = '';
      return;
    }

    ui.card.classList.remove('centered');

    var x = Math.max(0, rect.left - PAD);
    var y = Math.max(0, rect.top - PAD);
    var w = Math.min(vw, rect.right + PAD) - x;
    var h = Math.min(vh, rect.bottom + PAD) - y;

    // top / bottom / left / right panels around the hole
    p[0].style.cssText = 'left:0;top:0;width:' + vw + 'px;height:' + Math.max(0, y) + 'px';
    p[1].style.cssText = 'left:0;top:' + (y + h) + 'px;width:' + vw + 'px;height:' + Math.max(0, vh - y - h) + 'px';
    p[2].style.cssText = 'left:0;top:' + y + 'px;width:' + Math.max(0, x) + 'px;height:' + Math.max(0, h) + 'px';
    p[3].style.cssText = 'left:' + (x + w) + 'px;top:' + y + 'px;width:' + Math.max(0, vw - x - w) + 'px;height:' + Math.max(0, h) + 'px';

    ui.ring.style.opacity = '1';
    ui.ring.style.left = x + 'px';
    ui.ring.style.top = y + 'px';
    ui.ring.style.width = w + 'px';
    ui.ring.style.height = h + 'px';

    // Card
    var cw = ui.card.offsetWidth;
    var ch = ui.card.offsetHeight;
    var placement = (run && run.steps[run.index] && run.steps[run.index].placement) || 'auto';
    var below = y + h + MARGIN;
    var above = y - MARGIN - ch;
    var top;
    if (placement === 'top') {
      top = above >= MARGIN ? above : below;
    } else if (placement === 'bottom') {
      top = below + ch <= vh - MARGIN ? below : above;
    } else {
      top = below + ch <= vh - MARGIN ? below : (above >= MARGIN ? above : below);
    }
    top = Math.max(MARGIN, Math.min(top, vh - ch - MARGIN));

    var left = rect.left + rect.width / 2 - cw / 2;
    left = Math.max(MARGIN, Math.min(left, vw - cw - MARGIN));

    ui.card.style.left = Math.round(left) + 'px';
    ui.card.style.top = Math.round(top) + 'px';
  }

  function reposition() {
    if (!run || !ui) return;
    var step = run.steps[run.index];
    var node = run.node && usable(run.node) ? run.node : resolveTarget(step);
    run.node = node;
    layout(node ? node.getBoundingClientRect() : null);
  }

  var repositionQueued = false;
  function queueReposition() {
    if (repositionQueued) return;
    repositionQueued = true;
    frame().then(function () {
      repositionQueued = false;
      reposition();
    });
  }

  /* ================================================================== *
   * 5. Running a tour
   * ================================================================== */

  var run = null;

  function onKeyDown(e) {
    if (!run) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      // Swallow it so an open <dialog> underneath does not close too.
      e.preventDefault();
      e.stopPropagation();
      finish('skipped');
    }
  }

  function onDocClick(e) {
    if (!run || !run.node) return;
    var step = run.steps[run.index];
    if (!step || step.advanceOn !== 'click') return;
    if (run.node === e.target || run.node.contains(e.target)) {
      window.setTimeout(function () { go(1); }, 120);
    }
  }

  function bindGlobals() {
    on(document, 'keydown', onKeyDown, true);
    on(document, 'click', onDocClick, true);
    on(window, 'resize', queueReposition);
    on(window, 'scroll', queueReposition, true);
    on(window, 'orientationchange', queueReposition);
  }

  function unbindGlobals() {
    off(document, 'keydown', onKeyDown, true);
    off(document, 'click', onDocClick, true);
    off(window, 'resize', queueReposition);
    off(window, 'scroll', queueReposition, true);
    off(window, 'orientationchange', queueReposition);
  }

  /** `title` / `body` / `tryIt` / `actions` may be values or ctx → value. */
  function resolveField(v, ctx) {
    return typeof v === 'function' ? v(ctx) : v;
  }

  /* ---- Step plan: which steps will actually be shown, and their numbers ---- *
   * Built once at the start (after the first `before` hook has run) and
   * trimmed if a step turns out to be missing after all, so the counter never
   * shows a gap like "1 of 4" → "3 of 4".
   * ------------------------------------------------------------------------ */

  function buildPlan(steps, ctx) {
    var plan = [];
    var unknown = false;
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      // A `when` predicate answers for steps we cannot probe yet (their target
      // only appears once an earlier `before` has opened something).
      if (s.when && !s.when(ctx)) continue;
      // Any later `before` hook rearranges the page, so from there on we
      // cannot tell by looking — assume those steps will show.
      if (i > 0 && s.before) unknown = true;
      if (unknown || !s.target || s.fallback) {
        plan.push(i);
      } else if (resolveTarget(s)) {
        plan.push(i);
      }
    }
    return plan;
  }

  function planIndex(i) {
    var plan = run.plan;
    if (plan.indexOf(i) === -1) {
      // A step we wrote off has turned up after all — slot it back in.
      var at = 0;
      while (at < plan.length && plan[at] < i) at++;
      plan.splice(at, 0, i);
    }
    return plan.indexOf(i);
  }

  function dropFromPlan(i) {
    var at = run.plan.indexOf(i);
    if (at >= 0) run.plan.splice(at, 1);
  }

  function isLastStep(i) {
    return !run.plan.length || run.plan[run.plan.length - 1] === i;
  }

  function isFirstStep(i) {
    return !run.plan.length || run.plan[0] === i;
  }

  function renderCard(step, node) {
    var ctx = run.ctx;
    // A `fallback: 'center'` step with no target gets its own copy, explaining
    // what will appear there once the user has something to see.
    var centred = !node && step.fallback === 'center';
    var tryIt = centred ? null : resolveField(step.tryIt, ctx);
    var actions = resolveField(step.actions, ctx) || [];

    var pos = planIndex(run.index) + 1;
    ui.counter.hidden = !!step.bare;
    ui.counter.textContent = pos + ' of ' + run.plan.length;
    ui.title.textContent = resolveField(centred && step.fallbackTitle ? step.fallbackTitle : step.title, ctx) || '';
    ui.body.textContent = resolveField(centred && step.fallbackBody ? step.fallbackBody : step.body, ctx) || '';
    ui.tryIt.hidden = !tryIt;
    ui.tryIt.textContent = tryIt ? 'Try it: ' + tryIt : '';

    while (ui.extra.firstChild) ui.extra.removeChild(ui.extra.firstChild);
    ui.extra.hidden = !actions.length;
    actions.forEach(function (a) {
      var b = button('btn ' + (a.cls || 'block'), a.text);
      on(b, 'click', function () {
        Promise.resolve(a.run ? a.run(run.ctx) : null).then(function () {
          if (a.advance !== false) go(1);
        });
      });
      ui.extra.appendChild(b);
    });

    ui.foot.hidden = !!step.bare;
    ui.back.disabled = isFirstStep(run.index);
    ui.next.textContent = isLastStep(run.index) ? 'Done' : 'Next';
    ui.card.classList.toggle('no-target', !node);
  }

  /**
   * Show step `i`, walking in `dir` past any step whose target is missing.
   */
  function show(i, dir) {
    if (!run) return Promise.resolve();
    var token = ++run.token;
    if (i < 0) i = 0;
    if (i >= run.steps.length) return finish('done');

    run.index = i;
    var step = run.steps[i];
    // The plan pass already ran the first step's `before`; don't repeat it.
    var skipBefore = run.skipBeforeFor === i;
    run.skipBeforeFor = -1;

    // A `before` hook moves the page around (opens a sheet, switches screen),
    // so park the overlay until the new step is measured and rendered.
    if (step.before && !skipBefore && ui) ui.root.style.visibility = 'hidden';

    return Promise.resolve()
      .then(function () {
        return step.before && !skipBefore ? step.before(run.ctx) : null;
      })
      .then(function () {
        if (run && run.token !== token) return null;
        return frame();
      })
      .then(function () {
        if (!run || run.token !== token) return null;
        ensureUI();
        var node = step.when && !step.when(run.ctx) ? null : resolveTarget(step);
        if (!node && (step.target || step.when) && step.fallback !== 'center') {
          // Missing target and nothing to fall back on → keep walking, and
          // take the step out of the plan so the numbering stays gapless.
          dropFromPlan(i);
          var nextIndex = i + (dir < 0 ? -1 : 1);
          if (nextIndex < 0) return show(0, 1);
          if (nextIndex >= run.steps.length) return finish('done');
          return show(nextIndex, dir);
        }
        run.node = node;
        if (node) {
          try {
            node.scrollIntoView({ block: 'center', inline: 'nearest' });
          } catch (e) {
            node.scrollIntoView();
          }
        }
        return frame().then(function () {
          if (!run || run.token !== token) return;
          renderCard(step, node);
          reposition();
          // Let the card settle (fonts/wrapping) then measure once more.
          return frame().then(function () {
            if (!run || run.token !== token) return;
            reposition();
            ui.root.style.visibility = '';
            try {
              ui.card.focus({ preventScroll: true });
            } catch (e) {
              ui.card.focus();
            }
          });
        });
      });
  }

  function go(delta) {
    if (!run) return;
    if (delta > 0 && isLastStep(run.index)) {
      finish('done');
      return;
    }
    var next = run.index + delta;
    if (next >= run.steps.length) {
      finish('done');
      return;
    }
    if (next < 0) next = 0;
    show(next, delta);
  }

  function finish(reason) {
    if (!run) return Promise.resolve({ reason: 'none' });
    var r = run;
    run = null;
    unbindGlobals();
    destroyUI();
    if (reason === 'done' && TOURS[r.id]) markSeen(r.id);
    var result = { id: r.id, reason: reason, ctx: r.ctx };
    try {
      if (r.opts && typeof r.opts.onDone === 'function') r.opts.onDone(result);
    } catch (e) {
      /* ignore */
    }
    if (r.after) {
      return Promise.resolve(r.after(r.ctx, result)).then(function () {
        r.resolve(result);
        return result;
      });
    }
    r.resolve(result);
    return Promise.resolve(result);
  }

  function stop() {
    if (run) finish('stopped');
  }

  /* ================================================================== *
   * 6. Sample project (for the counter / import tours)
   * ================================================================== */

  var SAMPLE_NAME = 'Tour sheep';
  var SAMPLE_PATTERN = [
    'Rnd 1: 6 sc in MR (6)',
    'Rnd 2: inc x6 (12)',
    'Rnd 3: (sc, inc) x6 (18)',
    'Rnd 4: (sc 2, inc) x6 (24)',
    'Rnd 5-8: sc around (24)',
    'Rnd 9: (sc 2, dec) x6 (18)'
  ].join('\n');

  function openProject() {
    try {
      return window.Store.project(window.Store.getState().activeProjectId);
    } catch (e) {
      return null;
    }
  }

  /** Make sure a project is open. Creates the sample one when there is none. */
  function ensureProject(ctx) {
    // The counter tour points at the crochet screen, so only a crochet
    // project will do: a cross-stitch or sewing project renders #screen-craft
    // and every step's target would be missing.
    function isCrochet(proj) { return !!proj && (proj.craft || 'crochet') === 'crochet'; }
    var p = openProject();
    if (isCrochet(p)) return p;
    var all = window.Store.projects().filter(isCrochet);
    if (all.length) {
      window.Store.setActiveProject(all[0].id);
      rerender();
      return all[0];
    }
    var created = window.Store.createProject({
      name: SAMPLE_NAME,
      emoji: '🐑',
      templateId: 'sheep',
      countMode: 'rounds',
      groupSize: 10
    });
    var body = created.parts[0];
    if (body) {
      window.Store.updatePart(created.id, body.id, {
        patternText: SAMPLE_PATTERN,
        targetRows: 9
      });
    }
    window.Store.setActiveProject(created.id);
    window.Store.clearUndo();
    ctx.sampleId = created.id;
    rerender();
    return created;
  }

  function deleteSample(ctx) {
    if (!ctx || !ctx.sampleId) return;
    var p = window.Store.project(ctx.sampleId);
    if (!p) return;
    window.Store.setActiveProject(null);
    window.Store.deleteProject(ctx.sampleId);
    window.Store.clearUndo();
    ctx.sampleId = null;
    rerender();
    var t = app('toast');
    if (t) t('Sample project removed');
  }

  /**
   * The closing step of the counter tour. When the tour made a sample project
   * it offers to bin it; otherwise it is just a sign-off.
   */
  function sampleOfferStep() {
    return {
      target: null,
      title: 'That is the whole counter',
      body: function (ctx) {
        if (ctx.sampleId && window.Store.project(ctx.sampleId)) {
          return 'You have seen every button on this screen. “' + SAMPLE_NAME + '” was made just for the ' +
            'tour — bin it now, or keep it around to practise on.';
        }
        return 'You have seen every button on this screen. Everything else lives behind the ⋯ menu, and ' +
          'this tour is always in Settings if you want it again.';
      },
      actions: function (ctx) {
        if (!ctx.sampleId || !window.Store.project(ctx.sampleId)) return [];
        return [
          {
            text: 'Delete the sample project',
            cls: 'danger block',
            run: function (c) { deleteSample(c); }
          },
          {
            text: 'Keep it',
            cls: 'block',
            run: function () {
              var t = app('toast');
              if (t) t('Kept — it is on your home screen');
            }
          }
        ];
      }
    };
  }

  /* ================================================================== *
   * 7. Tour definitions
   * ================================================================== */

  /** The project the checklist steps would act on, if there is one. */
  function someProject() {
    try {
      return openProject() || window.Store.projects()[0] || null;
    } catch (e) {
      return null;
    }
  }

  function hasProject() {
    return !!someProject();
  }

  /** True when that project still has a template to reload its checklist from. */
  function hasProjectTemplate() {
    var p = someProject();
    try {
      return !!(p && p.templateId && window.Store.template(p.templateId));
    } catch (e) {
      return false;
    }
  }

  function goHomeScreen() {
    if (openProject()) {
      window.Store.setActiveProject(null);
      rerender();
    }
  }

  var TOURS = {
    home: {
      id: 'home',
      title: 'Around the home screen',
      blurb: 'Projects, the settings gear and the finished shelf.',
      steps: function () {
        return [
          {
            target: '#btn-new',
            before: function () { goHomeScreen(); var c = app('closeAllSheets'); if (c) c(); },
            title: 'Start something new',
            body:
              'Tap ＋ New whenever you cast on. You give it a name, an emoji and a template, ' +
              'and all the parts are set up for you.'
          },
          {
            target: '#home-list .project-card',
            fallback: 'center',
            title: 'Your projects',
            body:
              'Each card shows the part you are on, the row you are on and the stitches so far. ' +
              'Tap one to pick up exactly where you left off.',
            fallbackTitle: 'Your projects',
            fallbackBody:
              'Once you start a project it shows up here as a card with the part, round and stitch ' +
              'you are on. Tap it to open.'
          },
          {
            target: '#btn-settings',
            title: 'Settings and themes',
            body:
              'Six themes live behind the gear, along with sounds, haptics, your templates, ' +
              'backups and these tours.'
          },
          {
            target: '#home-finished',
            fallback: 'center',
            title: 'The finished shelf',
            body:
              'Mark a project finished or frogged and it tucks itself away down here. ' +
              'Paused ones stay up top, still counting.',
            fallbackTitle: 'The finished shelf',
            fallbackBody:
              'Finished and frogged projects move to a shelf down here so the list stays tidy. ' +
              'Paused ones stay up top, still counting.'
          }
        ];
      }
    },

    counter: {
      id: 'counter',
      title: 'Counting a project',
      blurb: 'The row counter, the stitch button and everything around them.',
      steps: function (ctx, opts) {
        var steps = [
          {
            target: '#part-tabs',
            before: function (c) {
              var cl = app('closeAllSheets');
              if (cl) cl();
              ensureProject(c);
            },
            title: 'One tab per piece',
            body:
              'Every piece counts separately. Tap a tab to switch to it, and tap the tab you are ' +
              'already on to edit it. A part you make twice shows 0/2 until both are done.'
          },
          {
            target: '[data-tour="row-counter"]',
            title: 'Rows and rounds',
            body:
              'The big number is how many rows (or rounds) you have finished. + completes one, ' +
              '– takes one back. Give the part a target and a progress bar shows up here too.'
          },
          {
            target: '#stitch-btn',
            title: 'The stitch button',
            body:
              'This is the one you will wear out. Tap anywhere on it to count a stitch — it fires ' +
              'the moment your finger lands, and a drag counts as a scroll instead.',
            tryIt: 'tap it three times, then come back here.'
          },
          {
            // Only there when the live diagram is on — the step trims itself out
            // when the canvas is missing.
            target: '#stitch-canvas',
            title: 'Your piece, in 3D',
            body: 'This is your piece growing as you count. Tap ⤢ to spin it around.'
          },
          {
            target: '#stitch-readout',
            title: 'Groups and targets',
            body:
              '“Group 2 of 3 · stitch 4 of 10” keeps your place mid-row. 13 / 24 means your pattern ' +
              'wants 24 stitches; a ≈ in front means we worked that number out from the instructions. ' +
              'Set group size to 0 and the grouping goes away.'
          },
          {
            target: '#pattern-line',
            title: 'Your pattern, one line at a time',
            body:
              'The row you are working shows up right here. Tap it to read the whole pattern, ' +
              'and tap any row in there to jump the counter straight to it.'
          },
          {
            target: '#btn-undo',
            title: 'Undo',
            body:
              'Miscounted? Undo steps back through your last taps — rows, stitches, even a deleted ' +
              'part or project.'
          },
          {
            target: '#btn-wake',
            title: 'Keep the screen awake',
            body:
              'Turn this on and your phone stops dimming while a project is open. It lets go again ' +
              'as soon as you leave.'
          },
          {
            target: '#btn-alerts',
            title: 'Stitch alerts',
            body:
              'Tell it to buzz at stitch 40 and 80 and it will, every single row. Handy for the ' +
              'increases you always sail past.'
          },
          {
            target: '#btn-place',
            title: 'Placing notes',
            body:
              'Somewhere to park “eyes between rnd 8–9, 6 sts apart”, so you are not ' +
              'scrolling a PDF with a hook in your hand.'
          },
          {
            target: '#p-timer',
            title: 'The timer',
            body:
              'Tap the clock to start and stop it. It belongs to this project, and only one project ' +
              'ever runs at a time.'
          },
          {
            target: '#p-menu',
            title: 'Everything else',
            body:
              'Behind the ⋯ you will find Import pattern, Parts, Checklist, Notes, Yarn colours, ' +
              'History, Status, Save as template and Download backup. “Show me around” in there ' +
              'starts this tour again.'
          }
        ];
        if (!opts || opts.sampleOffer !== false) steps.push(sampleOfferStep());
        return steps;
      }
    },

    "import": {
      id: 'import',
      title: 'Importing a pattern',
      blurb: 'Paste straight from a PDF and let it find the parts.',
      steps: function () {
        return [
          {
            target: '[data-tour="import-drop"]',
            before: function (c) {
              var cl = app('closeAllSheets');
              if (cl) cl();
              var p = ensureProject(c);
              var open = app('openImportSheet');
              if (open && p) open(p.id, '');
              return wait(60);
            },
            title: 'Start with the PDF',
            body:
              'Drop the PDF from your pattern shop right here, or paste text below. It is read on ' +
              'your own device — nothing is uploaded anywhere.'
          },
          {
            target: '[data-tour="import-text"]',
            title: 'Paste it straight in',
            body:
              'No PDF? Copy the instructions out of your pattern and drop them in this box. ' +
              'Two-column bleed, stray photo labels and the odd typo are all fine.'
          },
          {
            target: '[data-tour="import-list"]',
            title: 'The sections it found',
            body:
              'Headings like BODY or “Wings (make 2)” each become a part, with the make-count picked ' +
              'up for you. Rename any of them, or untick the ones you do not want.'
          },
          {
            target: '[data-tour="import-create"]',
            title: 'Create parts, or keep it in one',
            body:
              'Create parts makes (or updates) one part per ticked section. If your pattern is just ' +
              'one piece, “Put it all in …” drops the whole text into the part you are on.'
          },
          {
            target: null,
            before: function () {
              var cl = app('closeAllSheets');
              if (cl) cl();
              rerender();
              return wait(60);
            },
            title: 'Where it turns up',
            body:
              'Back on the counter, the current row of your pattern sits under the big number and its ' +
              'stitch count appears beside your stitches. A ≈ means we computed that count from the ' +
              'instructions rather than reading it off the page.'
          }
        ];
      }
    },

    templates: {
      id: 'templates',
      title: 'Templates and checklists',
      blurb: 'Reusable part lists, and the assembly list at the end.',
      steps: function () {
        return [
          {
            target: '[data-tour="settings-templates"]',
            before: function () {
              var cl = app('closeAllSheets');
              if (cl) cl();
              var open = app('openSettingsSheet');
              if (open) open();
              return wait(60);
            },
            title: 'Templates',
            body:
              'A template is the set of parts and the assembly checklist a new project starts with. ' +
              'Tap one to edit it — the built-in ones can be changed, and reset to default at any time.'
          },
          {
            target: '[data-tour="settings-new-template"]',
            title: 'Make your own',
            body:
              'Build a template out of the parts you always make, then pick it for every new project. ' +
              '“Save as template” in a project’s ⋯ menu does it from a project you already have.'
          },
          {
            target: '[data-tour="checklist-list"]',
            when: hasProject,
            before: function () {
              var cl = app('closeAllSheets');
              if (cl) cl();
              var p = openProject();
              if (!p) {
                var all = window.Store.projects();
                if (all.length) {
                  window.Store.setActiveProject(all[0].id);
                  rerender();
                  p = all[0];
                }
              }
              var open = app('openChecklistSheet');
              if (open && p) open(p.id);
              return wait(60);
            },
            title: 'The assembly checklist',
            body:
              'Every project gets its template’s checklist. Tick things off as you sew, tap an item’s ' +
              'text to rename it, and use ▲▼ to shuffle the order.'
          },
          {
            target: '[data-tour="checklist-reload"]',
            when: hasProjectTemplate,
            title: 'Reload from the template',
            body:
              'Improved the template later on? This pulls the fresh list in. It replaces what is here, ' +
              'so do it before you start ticking.'
          },
          {
            target: null,
            before: function () {
              var cl = app('closeAllSheets');
              if (cl) cl();
              rerender();
              return wait(60);
            },
            title: 'That is the lot',
            body:
              'Templates set a project up; the checklist sees it out the door. Both live in Settings ' +
              'and in the ⋯ menu, and both are yours to rewrite.'
          }
        ];
      }
    }
  };

  var ORDER = ['home', 'counter', 'import', 'templates'];

  /* ================================================================== *
   * 8. Public API
   * ================================================================== */

  function runSteps(id, steps, opts, ctx) {
    if (run) finish('stopped');
    return new Promise(function (resolve) {
      run = {
        id: id,
        steps: steps,
        index: 0,
        plan: steps.map(function (s, i) { return i; }),
        skipBeforeFor: -1,
        ctx: ctx,
        opts: opts,
        after: opts.after || null,
        node: null,
        token: 0,
        resolve: resolve
      };
      var r = run;
      ensureUI();
      // The card still holds the last tour's text until the first step renders.
      ui.root.style.visibility = 'hidden';
      bindGlobals();

      // Run the opening `before` first, then work out which steps will really
      // show — so the counter reads "1 of 4 … 4 of 4" with no gaps.
      Promise.resolve()
        .then(function () {
          return steps[0].before ? steps[0].before(ctx) : null;
        })
        .then(frame)
        .then(function () {
          if (run !== r) return;
          run.plan = buildPlan(steps, ctx);
          if (!run.plan.length) run.plan = [0];
          run.skipBeforeFor = 0;
          show(0, 1);
        })
        .catch(function () {
          if (run === r) show(0, 1);
        });
    });
  }

  /**
   * @param {string} id
   * @param {{ onDone?:Function, sampleOffer?:boolean, after?:Function, ctx?:Object }} [opts]
   * @returns {Promise<{id:string, reason:string, ctx:Object}>}
   */
  function start(id, opts) {
    opts = opts || {};
    var def = TOURS[id];
    if (!def) return Promise.resolve({ id: id, reason: 'unknown', ctx: {} });

    var ctx = opts.ctx || {};
    var steps;
    try {
      steps = def.steps(ctx, opts) || [];
    } catch (e) {
      steps = [];
    }
    if (!steps.length) return Promise.resolve({ id: id, reason: 'empty', ctx: ctx });
    return runSteps(id, steps, opts, ctx);
  }

  /**
   * A single centred card with two choices, in the same spotlight chrome —
   * used to hand off between tours instead of jumping silently.
   * @param {{title:string, body:string, confirmText?:string, cancelText?:string}} o
   * @returns {Promise<boolean>}
   */
  function prompt(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var answered = false;
      function answer(v) {
        if (answered) return;
        answered = true;
        resolve(v);
      }
      runSteps(
        '__prompt',
        [{
          target: null,
          bare: true,
          title: o.title,
          body: o.body,
          actions: [
            { text: o.confirmText || 'Show me', cls: 'primary block', run: function () { answer(true); } },
            { text: o.cancelText || 'Not now', cls: 'block', run: function () { answer(false); } }
          ]
        }],
        { onDone: function () { answer(false); } },
        {}
      );
    });
  }

  function list() {
    return ORDER.map(function (id) {
      var t = TOURS[id];
      return { id: id, title: t.title, blurb: t.blurb, seen: hasSeen(id) };
    });
  }

  /**
   * A craft module ships its own walkthrough: same { id, title, blurb, steps }
   * shape as the built-in four. It then shows up in Tour.list(), and so in
   * Settings → Help & tours, with no further wiring.
   * @param {{id:string, title:string, blurb:string, steps:Function}} def
   * @returns {boolean} whether it was added
   */
  function register(def) {
    if (!def || typeof def !== 'object') return false;
    var id = typeof def.id === 'string' ? def.id.trim() : '';
    if (!id || typeof def.steps !== 'function') return false;
    TOURS[id] = {
      id: id,
      title: typeof def.title === 'string' && def.title ? def.title : id,
      blurb: typeof def.blurb === 'string' ? def.blurb : '',
      steps: def.steps
    };
    if (ORDER.indexOf(id) === -1) ORDER.push(id);
    return true;
  }

  window.Tour = {
    start: start,
    register: register,
    prompt: prompt,
    stop: stop,
    list: list,
    hasSeen: hasSeen,
    markSeen: markSeen,
    isRunning: function () { return !!run; },
    SAMPLE_NAME: SAMPLE_NAME
  };
})();
