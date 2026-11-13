/* Thready or Not — js/workmode.js
 * window.WorkMode : the full-screen working mode, for every craft (wave K, shell-ui).
 *
 * Wave I built a working mode for the crochet counter (js/app.js "15c"): the
 * stitch button full screen with the 3D piece in it, big numbers, the pattern
 * line, the next row, big corner buttons, Options, keyboard, landscape, and
 * the mode remembered per project. This file is that mode with the crochet
 * taken out, so a craft module registers a `workMode` spec and gets the same
 * screen (docs/wave-k/api/shell-ui.md §1):
 *
 *   the SHELL (this file + js/app.js) owns the full-screen layout in portrait
 *   and landscape, the safe areas, the header (✕ · title · Options ▾), the
 *   corner buttons, the Options panel (with ☀ Keep awake), the keyboard and
 *   page-turner pedal keys, the exit path, the remembered state, the open /
 *   close announcements, the count cadence (countPolicy) and reduced motion;
 *
 *   the CRAFT supplies the surface (a canvas, a step card, a chart) and the
 *   actions (primary, forward, back, undo, extra buttons), and what the HUD
 *   says (readout()).
 *
 * Crochet and knitting run through the same engine with `adopt: true` (the
 * counter's own stitch button is the surface, styled by css/app.css) and the
 * `build` / `paint` hooks that keep wave I's HUD content exactly as it was.
 *
 * No DOM is touched at script time; nothing here reads the Store directly
 * (the shell hands an `env`), so test/workmode.test.html drives it alone.
 * ES5, one global.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var TAP_SLOP = 12;             // px: the counter's own press-and-release tolerance
  var SIDE_MQ = '(orientation: landscape)';
  var MOTION_MQ = '(prefers-reduced-motion: reduce)';

  /* ---------------------------------------------------------------- *
   * Pure helpers
   * ---------------------------------------------------------------- */

  function plural(unit) {
    var u = String(unit || 'stitch');
    if (/(?:s|x|ch|sh)$/i.test(u)) return u + 'es';
    if (/[^aeiou]y$/i.test(u)) return u.slice(0, -1) + 'ies';
    return u + 's';
  }

  function fmt(n) {
    var v = Math.round(Number(n) || 0);
    var s = String(Math.abs(v));
    if (s.length > 4) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '-' : '') + s;
  }

  /**
   * The page-turner / keyboard map. Bluetooth page turners send PageDown /
   * PageUp or the arrow keys; a foot switch often sends Space or Enter.
   * @returns {'primary'|'forward'|'back'|'close'|null}
   */
  function keyAction(e) {
    var k = e && e.key;
    if (k === 'Escape' || k === 'Esc') return 'close';
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') return 'primary';
    if (k === 'ArrowUp' || k === 'ArrowRight' || k === 'PageDown') return 'forward';
    if (k === 'ArrowDown' || k === 'ArrowLeft' || k === 'PageUp') return 'back';
    return null;
  }

  /**
   * The ONE announcement policy (js/app.js §5, docs/CRAFTS.md): milestones
   * only — a row / round / step / colour / group / piece done, and, only where
   * nothing groups the count, every 50th. Never a single stitch.
   * @param {{n?:number,total?:number,unit?:string,units?:string,label?:string,
   *          kind?:string,groupSize?:number,say?:string}} ev
   * @returns {{say: string|null, fb: string}}
   */
  function countPolicy(ev) {
    ev = ev || {};
    var kind = ev.kind || 'tap';
    var n = Number(ev.n) || 0;
    var total = Number(ev.total) || 0;
    var units = ev.units || plural(ev.unit || 'stitch');
    var say = null;
    if (kind === 'row' || kind === 'done' || kind === 'group' || kind === 'alert') {
      say = ev.say || (ev.label ? ev.label + ' done' : null);
      return { say: say, fb: kind };
    }
    if (kind === 'undo') return { say: ev.say || null, fb: 'undo' };
    // a plain tap
    if (total > 0 && n === total) {
      say = ev.say || (ev.label ? ev.label + ': ' : '') + fmt(n) + ' of ' + fmt(total) + ' ' + units;
    } else if (!(ev.groupSize > 0) && n > 0 && n % 50 === 0) {
      say = (ev.label ? ev.label + ': ' : '') + fmt(n) + (total > 0 ? ' of ' + fmt(total) : '') + ' ' + units;
    }
    return { say: say, fb: 'tap' };
  }

  function mq(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- *
   * DOM helpers (private copies: this file loads before js/app.js)
   * ---------------------------------------------------------------- */

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

  function focus(node) {
    if (!node || typeof node.focus !== 'function') return;
    try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) { /* ignore */ } }
  }

  function call(fn, self, a, b) {
    if (typeof fn !== 'function') return undefined;
    try { return fn.call(self, a, b); } catch (e) {
      if (window.console && console.error) console.error('WorkMode: craft hook failed', e);
      return undefined;
    }
  }

  function isTextTarget(t) {
    var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!(t && t.isContentEditable);
  }

  function isControl(t) {
    var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    return tag === 'button' || tag === 'a' || !!(t && t.getAttribute && t.getAttribute('role') === 'button');
  }

  /* ---------------------------------------------------------------- *
   * The one keydown listener: every live session hears it
   * ---------------------------------------------------------------- */

  var sessions = [];
  var listening = false;

  function listen() {
    if (listening) return;
    listening = true;
    document.addEventListener('keydown', function (e) {
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].handleKey(e)) return;
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * A session: one host screen, one craft spec
   * ---------------------------------------------------------------- */

  /**
   * @param {HTMLElement} host   the screen that goes full screen (#screen-project, #screen-craft)
   * @param {Object} spec        the craft's workMode spec (see the API doc)
   * @param {Object} env         the shell: { remember(on), announce(t), counted(ev), blocked(),
   *                             wake:{supported,isOn,toggle}, undo(), render(), project(), fb(kind) }
   */
  function create(host, spec, env) {
    spec = spec || {};
    env = env || {};
    var s = {
      on: false,
      hud: null,
      surface: null,
      hooks: null,
      nodes: {},
      buttons: {},
      panelOpen: false,
      insetKey: '',
      readKey: '',
      ro: null
    };

    var api = {
      host: host,
      get surface() { return s.surface; },
      get hud() { return s.hud; },
      get nodes() { return s.nodes; },
      project: function () { return call(env.project); },
      refresh: function () { refresh(); },
      close: function () { closeUser(); },
      announce: function (t) { call(env.announce, null, t); },
      counted: function (ev) {
        if (typeof env.counted === 'function') return env.counted(ev);
        var r = countPolicy(ev);
        if (r.say) call(env.announce, null, r.say);
        call(env.fb, null, r.fb);
        return { said: r.say, fb: r.fb };
      },
      insets: function () { return measure(true); },
      landscape: function () { return mq(SIDE_MQ); },
      /** true when the spec asked for `surfaceUnderHud` (the surface fills the screen under the HUD) */
      underHud: function () { return !!spec.surfaceUnderHud && !spec.adopt; },
      reducedMotion: function () { return mq(MOTION_MQ); },
      setPanel: function (open) { setPanel(open); },
      awakeButton: function () { return awakeButton(); },
      session: null
    };

    /* ---- the HUD skeleton (class names shared with wave I's CSS) ---- */

    function ensureHud() {
      if (s.hud && host.contains(s.hud)) return s.hud;
      var n = (s.nodes = {});
      s.buttons = {};
      var hud = el('div', 'work-hud' + (spec.cls ? ' ' + spec.cls : ''));
      if (spec.hudId) hud.id = spec.hudId;
      hud.hidden = true;
      hud.setAttribute('role', 'region');
      hud.setAttribute('aria-label', spec.regionLabel || spec.label || 'Working mode');

      var head = el('div', 'work-head');
      var close = button('work-icon work-close', '✕', 'Close ' + (spec.label || 'working mode').toLowerCase());
      close.addEventListener('click', function () { closeUser(); });
      n.close = close;
      n.title = el('div', 'work-title');
      var more = button('work-icon work-more', null, (spec.label || 'Working mode') + ' options');
      more.appendChild(el('span', 'work-more-text', 'Options'));
      more.appendChild(el('span', 'work-more-caret', '▾'));
      more.setAttribute('aria-expanded', 'false');
      var panelId = (spec.hudId || 'work-hud') + '-panel';
      if (spec.panelId) panelId = spec.panelId;
      more.setAttribute('aria-controls', panelId);
      more.addEventListener('click', function () { setPanel(!s.panelOpen); });
      head.appendChild(close);
      head.appendChild(n.title);
      head.appendChild(more);
      n.head = head;
      n.more = more;

      n.stack = el('div', 'work-stack');

      var foot = el('div', 'work-foot');
      n.tip = el('div', 'work-tip', spec.tip || 'Tap anywhere to count');
      n.next = el('div', 'work-next');
      n.nextTag = el('span', 'work-next-tag');
      n.nextText = el('span', 'work-next-text');
      n.next.appendChild(n.nextTag);
      n.next.appendChild(n.nextText);
      n.next.hidden = true;
      foot.appendChild(n.tip);
      foot.appendChild(n.next);
      n.foot = foot;

      n.btns = el('div', 'work-btns');
      buildButtons(n.btns);

      var scrim = el('div', 'work-scrim');
      scrim.hidden = true;
      scrim.addEventListener('click', function () { setPanel(false); });
      var panel = el('div', 'work-panel');
      panel.id = panelId;
      panel.hidden = true;
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', (spec.label || 'Working mode') + ' options');
      n.scrim = scrim;
      n.panel = panel;

      hud.appendChild(head);
      hud.appendChild(n.stack);
      hud.appendChild(foot);
      hud.appendChild(n.btns);
      hud.appendChild(scrim);
      hud.appendChild(panel);
      host.appendChild(hud);
      s.hud = hud;

      if (typeof spec.build === 'function') call(spec.build, spec, n, api);

      if (typeof window.ResizeObserver === 'function') {
        try {
          s.ro = new window.ResizeObserver(function () { if (s.on) measure(false); });
          s.ro.observe(n.stack);
          s.ro.observe(foot);
          s.ro.observe(n.btns);
        } catch (e) { s.ro = null; }
      }
      s.readKey = '';
      return hud;
    }

    function cornerButton(b) {
      var node = button('work-btn' + (b.cls ? ' ' + b.cls : '') + (b.accent ? ' work-accent' : ''), null, b.label);
      node.appendChild(el('span', 'work-btn-glyph', b.glyph || '•'));
      if (b.word) node.appendChild(el('span', 'work-btn-word', b.word));
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        if (node.disabled) return;
        call(b.run, b, api);
      });
      return node;
    }

    /** −1, Undo … back, forward: wave I's corners, from the spec. */
    function buildButtons(row) {
      var start = [], end = [];
      (Array.isArray(spec.secondary) ? spec.secondary : []).forEach(function (b, i) {
        if (!b || typeof b.run !== 'function') return;
        var d = { id: b.id || 'b' + i, spec: b };
        if (b.side === 'end') end.push(d); else start.push(d);
      });
      if (spec.undo) {
        var u = spec.undo === true ? {} : spec.undo;
        start.push({ id: 'undo', spec: {
          glyph: u.glyph || '↶', label: u.label || 'Undo last action', cls: u.cls || 'work-undo',
          run: u.run || function () { call(env.undo); },
          disabled: u.enabled ? function () { return !u.enabled(api); } : (env.canUndo ? function () { return !env.canUndo(); } : null)
        } });
      }
      if (spec.back && spec.back.button !== false) {
        end.unshift({ id: 'back', spec: {
          glyph: spec.back.glyph || '−', label: spec.back.label || 'Back', word: spec.back.word,
          cls: spec.back.cls || 'work-row-minus', run: spec.back.run, disabled: spec.back.disabled, hidden: spec.back.hidden
        } });
      }
      if (spec.forward && spec.forward.button !== false) {
        end.push({ id: 'forward', spec: {
          glyph: spec.forward.glyph || '+', label: spec.forward.label || 'Next', word: spec.forward.word,
          cls: spec.forward.cls || 'work-row-plus', accent: spec.forward.accent !== false,
          run: spec.forward.run, disabled: spec.forward.disabled, hidden: spec.forward.hidden
        } });
      }
      start.forEach(function (d) { s.buttons[d.id] = cornerButton(d.spec); s.buttons[d.id]._spec = d.spec; row.appendChild(s.buttons[d.id]); });
      row.appendChild(el('span', 'work-gap'));
      end.forEach(function (d) { s.buttons[d.id] = cornerButton(d.spec); s.buttons[d.id]._spec = d.spec; row.appendChild(s.buttons[d.id]); });
      s.nodes.buttons = s.buttons;
    }

    function syncButtons() {
      Object.keys(s.buttons).forEach(function (id) {
        var b = s.buttons[id], sp = b._spec || {};
        if (typeof sp.hidden === 'function') b.hidden = !!call(sp.hidden, sp, api);
        if (typeof sp.disabled === 'function') b.disabled = !!call(sp.disabled, sp, api);
      });
    }

    /* ---- the surface (a craft's own; crochet adopts its stitch button) ---- */

    function mountSurface() {
      if (spec.adopt || s.surface) return;
      var node = el('div', 'work-surface');
      node.tabIndex = 0;
      if (spec.tapSurface !== false && spec.primary) {
        node.setAttribute('role', 'button');
        node.setAttribute('aria-label', spec.primary.label || 'Count');
      }
      host.insertBefore(node, s.hud || null);
      s.surface = node;
      bindSurfaceTap(node);
      var hooks = call(spec.surface, spec, node, api);
      s.hooks = hooks && typeof hooks === 'object' ? hooks : null;
    }

    function unmountSurface() {
      if (s.hooks) call(s.hooks.destroy, s.hooks);
      s.hooks = null;
      if (s.surface && s.surface.parentNode) s.surface.parentNode.removeChild(s.surface);
      s.surface = null;
    }

    /** Press and release within 12 px counts; a drag (pan, spin) never does. */
    function bindSurfaceTap(node) {
      if (spec.tapSurface === false || !spec.primary) return;
      var down = null;
      node.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
      });
      node.addEventListener('pointermove', function (e) {
        if (!down || e.pointerId !== down.id) return;
        if (Math.abs(e.clientX - down.x) > TAP_SLOP || Math.abs(e.clientY - down.y) > TAP_SLOP) down.moved = true;
      });
      node.addEventListener('pointerup', function (e) {
        var d = down;
        down = null;
        if (!d || e.pointerId !== d.id || d.moved) return;
        if (Math.abs(e.clientX - d.x) > TAP_SLOP || Math.abs(e.clientY - d.y) > TAP_SLOP) return;
        if (s.panelOpen) { setPanel(false); return; }
        call(spec.primary.run, spec.primary, api);
      });
      node.addEventListener('pointercancel', function () { down = null; });
      node.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        if (e.target !== node) return;
        e.preventDefault();
        if (!e.repeat) call(spec.primary.run, spec.primary, api);
      });
    }

    /* ---- the declarative readout ---- */

    function paintReadout() {
      var n = s.nodes;
      var r = call(spec.readout, spec, api) || {};
      var key;
      try { key = JSON.stringify(r); } catch (e) { key = String(Math.random()); }
      if (key === s.readKey) return r;
      s.readKey = key;
      n.title.textContent = r.title || '';
      n.title.title = r.title || '';
      if (typeof spec.build !== 'function') {
        clear(n.stack);
        var cells = Array.isArray(r.cells) ? r.cells : [];
        if (cells.length) {
          var read = el('div', 'work-read');
          cells.forEach(function (c) {
            if (!c) return;
            var cell = el('div', 'work-cell' + (c.over ? ' over' : '') + (c.cls ? ' ' + c.cls : ''));
            if (c.cap) cell.appendChild(el('div', 'work-cap', c.cap));
            var line = el('div', 'work-numline');
            line.appendChild(el('span', 'work-big', c.big === undefined || c.big === null ? '' : c.big));
            line.appendChild(el('span', 'work-of', c.of || ''));
            cell.appendChild(line);
            if (c.sub) cell.appendChild(el('div', 'work-sub', c.sub));
            if (c.label) cell.setAttribute('aria-label', c.label);
            read.appendChild(cell);
          });
          n.stack.appendChild(read);
        }
        if (r.line && (r.line.text || r.line.tag)) {
          var wl = el('div', 'work-line');
          wl.appendChild(el('span', 'work-line-tag', r.line.tag || ''));
          var main = el('span', 'work-line-main');
          main.appendChild(el('span', 'work-line-text', r.line.text || ''));
          if (r.line.notes) main.appendChild(el('span', 'work-line-notes', r.line.notes));
          wl.appendChild(main);
          n.stack.appendChild(wl);
        }
        var hints = Array.isArray(r.hints) ? r.hints : [];
        if (hints.length) {
          var hw = el('div', 'work-hints');
          hints.forEach(function (h) {
            if (!h) return;
            var obj = typeof h === 'string' ? { text: h } : h;
            var hn = el('div', 'work-hint' + (obj.cls ? ' ' + obj.cls : ''), obj.text || '');
            if (obj.role) hn.setAttribute('role', obj.role);
            hw.appendChild(hn);
          });
          n.stack.appendChild(hw);
        }
        // next + tip
        var nx = r.next && (r.next.text || r.next.tag) ? r.next : null;
        n.next.hidden = !nx;
        if (nx) {
          n.nextTag.textContent = nx.tag || 'Next';
          n.nextText.textContent = nx.text || '';
          n.next.setAttribute('aria-label', (nx.tag || 'Next') + ': ' + (nx.text || ''));
        }
        n.tip.hidden = !r.tip;
        if (r.tip) n.tip.textContent = r.tip;
      }
      return r;
    }

    /* ---- Options ---- */

    function awakeButton() {
      var w = env.wake;
      if (!w || !w.supported) return null;
      var b = button('btn work-awake', '☀ Keep awake', 'Keep screen awake');
      b.addEventListener('click', function () {
        call(w.toggle, w);
        syncAwake();
      });
      return b;
    }

    function syncAwake() {
      var w = env.wake;
      if (!s.nodes.panel || !w) return;
      var on = !!call(w.isOn, w);
      Array.prototype.forEach.call(s.nodes.panel.querySelectorAll('.work-awake'), function (b) {
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function buildPanel() {
      var panel = s.nodes.panel;
      clear(panel);
      call(spec.panel, spec, panel, api);
      if (!panel.querySelector('.work-awake')) {
        var aw = awakeButton();
        if (aw) {
          var acts = el('div', 'work-actions');
          acts.appendChild(aw);
          panel.appendChild(acts);
        }
      }
      syncAwake();
    }

    function setPanel(open) {
      var n = s.nodes;
      if (!n.panel) return;
      open = !!open;
      var was = s.panelOpen;
      s.panelOpen = open;
      if (open) buildPanel();
      n.panel.hidden = !open;
      n.scrim.hidden = !open;
      n.more.setAttribute('aria-expanded', open ? 'true' : 'false');
      n.more.classList.toggle('on', open);
      if (open) {
        focus(n.panel.querySelector('button'));
      } else if (was && n.panel.contains(document.activeElement)) {
        focus(n.more);
      }
    }

    /* ---- the free area the HUD leaves for the surface ---- */

    /**
     * Portrait: between the readout stack and the next line / buttons.
     * Landscape: right of the readout column, between the header and the
     * buttons. Handed to the craft (`insets`) only when it changed.
     * @param {boolean} [force] return the value even when unchanged
     */
    function measure(force) {
      var n = s.nodes;
      if (!s.on || !n.stack) return null;
      var ref = spec.adopt ? call(spec.rectNode, spec) : (s.surface || host);
      if (!ref || !ref.getBoundingClientRect) return null;
      var br = ref.getBoundingClientRect();
      if (!br.width || !br.height) return null;
      var st = n.stack.getBoundingClientRect();
      var bt = n.btns.getBoundingClientRect();
      var ft = n.foot.getBoundingClientRect();
      var top, bottom, left = 8, right = 8;
      if (mq(SIDE_MQ)) {
        left = Math.max(8, st.right - br.left + 8);
        top = Math.max(8, n.head.getBoundingClientRect().bottom - br.top + 4);
        bottom = Math.max(8, br.bottom - bt.top + 4);
      } else {
        top = Math.max(8, st.bottom - br.top + 6);
        var low = ft.height > 0 ? Math.min(ft.top, bt.top) : bt.top;
        bottom = Math.max(8, br.bottom - low + 6);
      }
      var ins = { top: Math.round(top), right: right, bottom: Math.round(bottom), left: Math.round(left) };
      var key = ins.top + ',' + ins.right + ',' + ins.bottom + ',' + ins.left;
      if (key === s.insetKey && !force) return null;
      var changed = key !== s.insetKey;
      s.insetKey = key;
      if (changed) {
        if (s.hooks && typeof s.hooks.insets === 'function') call(s.hooks.insets, s.hooks, ins);
        if (typeof spec.onInsets === 'function') call(spec.onInsets, spec, ins, api);
      }
      return ins;
    }

    /* ---- on / off ---- */

    /** Show or hide the mode to match the remembered choice; no side effects. */
    function sync(want) {
      want = !!want;
      if (want) ensureHud();
      if (want === s.on) {
        // an adopted surface (the counter) repaints from its own update path
        if (want && !spec.adopt) refresh();
        return;
      }
      s.on = want;
      s.insetKey = '';
      host.classList.toggle('work-mode', want);
      host.classList.toggle('work-reduced-motion', want && mq(MOTION_MQ));
      // opt-in: the craft paints the whole screen; the HUD floats over it on scrims
      host.classList.toggle('work-under-hud', want && !!spec.surfaceUnderHud && !spec.adopt);
      if (s.hud) s.hud.hidden = !want;
      if (want) {
        if (sessions.indexOf(session) < 0) sessions.push(session);
        listen();
        mountSurface();
        if (!spec.adopt) refresh();
        call(spec.onOpen, spec, api);
      } else {
        setPanel(false);
        unmountSurface();
        call(spec.onClose, spec, api);
      }
      if (s.hooks && typeof s.hooks.resize === 'function') call(s.hooks.resize, s.hooks);
      call(spec.onToggle, spec, want, api);
    }

    function refresh() {
      if (!s.on || !s.hud) return;
      var r = typeof spec.paint === 'function' ? (call(spec.paint, spec, s.nodes, api) || {}) : paintReadout();
      if (typeof spec.paint === 'function' && r && r.title !== undefined) s.nodes.title.textContent = r.title;
      syncButtons();
      if (s.panelOpen) {
        call(spec.syncPanel, spec, s.nodes.panel, api);
        syncAwake();
      }
      measure(false);
    }

    function say() {
      var r = call(spec.readout, spec, api);
      return (r && r.say) || (typeof spec.say === 'function' ? call(spec.say, spec, api) : '') || '';
    }

    /** The user opened it: remember, buzz, render, say where they are. */
    function openUser() {
      call(env.remember, null, true);
      call(env.fb, null, 'tap');
      if (typeof env.render === 'function') env.render(); else sync(true);
      if (!s.on) sync(true);
      var t = say();
      call(env.announce, null, (spec.label || 'Working mode') + (t ? '. ' + t : ''));
      focus(typeof spec.focusNode === 'function' ? call(spec.focusNode, spec, api) : s.surface);
    }

    function closeUser() {
      var t = say();
      call(env.remember, null, false);
      call(env.fb, null, 'tap');
      if (typeof env.render === 'function') env.render(); else sync(false);
      if (s.on) sync(false);
      call(env.announce, null, 'Back to ' + (spec.backTo || 'the project') + '.' + (t ? ' ' + t : ''));
      focus(typeof spec.returnFocus === 'function' ? call(spec.returnFocus, spec, api) : null);
    }

    /** @returns {boolean} true when this session used the key */
    function handleKey(e) {
      if (!s.on || !host || host.hidden) return false;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (typeof env.blocked === 'function' && env.blocked()) return false;
      var t = e.target;
      if (isTextTarget(t)) return false;
      var inPanel = !!(s.nodes.panel && s.nodes.panel.contains(t));
      var act = keyAction(e);
      if (act === 'close') {
        e.preventDefault();
        if (s.panelOpen) setPanel(false); else closeUser();
        return true;
      }
      if (!inPanel && !s.panelOpen && spec.keys && typeof spec.keys[e.key] === 'function') {
        e.preventDefault();
        if (!e.repeat) call(spec.keys[e.key], spec.keys, api, e);
        return true;
      }
      if (act === 'primary') {
        // a focused control (the stitch button included) activates itself
        if (isControl(t)) return false;
        if (!spec.primary) return false;
        e.preventDefault();
        if (!e.repeat) call(spec.primary.run, spec.primary, api);
        return true;
      }
      if (inPanel || s.panelOpen) return false;
      if (act === 'forward' || act === 'back') {
        var a = act === 'forward' ? (spec.forward || spec.primary) : spec.back;
        if (!a || typeof a.run !== 'function') return false;
        e.preventDefault();
        if (!e.repeat) call(a.run, a, api);
        return true;
      }
      return false;
    }

    function destroy() {
      if (s.on) sync(false);
      if (s.ro) { try { s.ro.disconnect(); } catch (e) { /* ignore */ } s.ro = null; }
      if (s.hud && s.hud.parentNode) s.hud.parentNode.removeChild(s.hud);
      s.hud = null;
      var i = sessions.indexOf(session);
      if (i >= 0) sessions.splice(i, 1);
    }

    var session = {
      spec: spec,
      api: api,
      get nodes() { return s.nodes; },
      get buttons() { return s.buttons; },
      sync: sync,
      refresh: refresh,
      openUser: openUser,
      closeUser: closeUser,
      isOn: function () { return s.on; },
      panelOpen: function () { return s.panelOpen; },
      setPanel: setPanel,
      handleKey: handleKey,
      measure: measure,
      resetInsets: function () { s.insetKey = ''; },
      ensureHud: ensureHud,
      destroy: destroy
    };
    api.session = session;
    return session;
  }

  window.WorkMode = {
    version: VERSION,
    create: create,
    keyAction: keyAction,
    countPolicy: countPolicy,
    plural: plural,
    TAP_SLOP: TAP_SLOP
  };
})();
