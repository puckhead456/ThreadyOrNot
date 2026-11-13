/* Thready or Not — js/pageviewer.js
 * window.PageViewer : one pinch / zoom / pan / region-outline viewer for
 * page images (wave K, shell-ui; API in docs/wave-k/api/shell-ui.md §7).
 *
 * Cross-stitch's page viewer (wave F), sewing's page viewer and knitting's
 * chart sheet were three copies of the same thing: a page image you can
 * pinch, drag, wheel-zoom and double-tap, ‹ › between pages, and a box drawn
 * round the part of the page that matters. This is that thing once, so the
 * three can migrate to it in batch 2 (none is migrated here).
 *
 *   PageViewer.mount(frame, opts) → viewer     the viewer inside any element
 *   PageViewer.open(opts)          → sheet api  a sheet with ‹ ›, − Fit +
 *
 * Pages come as a Blob, a URL, a canvas, or a BlobStore key (`blobKey`, read
 * with window.BlobStore.get). Object URLs are revoked on a page change and
 * on destroy. Pure maths (`fitScale`, `clampPan`, `zoomAt`, `outlineBox`) is
 * exported for the tests. ES5, one global.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var DOUBLE_TAP_MS = 320;
  var MOVE_SLOP = 4;

  /* ---------------------------------------------------------------- *
   * Pure maths (all in frame px; `st` = { s, tx, ty, iw, ih, fitS })
   * ---------------------------------------------------------------- */

  function fitScale(iw, ih, fw, fh) {
    if (!(iw > 0 && ih > 0 && fw > 0 && fh > 0)) return 1;
    return Math.min(fw / iw, fh / ih);
  }

  /** Centre an image smaller than the frame; keep a bigger one covering it. */
  function clampPan(st, fw, fh) {
    var w = st.iw * st.s, h = st.ih * st.s;
    st.tx = w <= fw ? (fw - w) / 2 : Math.min(0, Math.max(fw - w, st.tx));
    st.ty = h <= fh ? (fh - h) / 2 : Math.min(0, Math.max(fh - h, st.ty));
    return st;
  }

  /** Zoom by `factor` keeping frame point (mx, my) still, within [fitS, fitS × max]. */
  function zoomAt(st, factor, mx, my, maxZoom, fw, fh) {
    var px = (mx - st.tx) / st.s, py = (my - st.ty) / st.s;
    st.s = Math.max(st.fitS, Math.min(st.fitS * (maxZoom || 12), st.s * factor));
    st.tx = mx - px * st.s;
    st.ty = my - py * st.s;
    return clampPan(st, fw, fh);
  }

  /**
   * An outline in image px from what a craft gives: image px `{x,y,w,h}` or
   * fractions of the page `{fx,fy,fw,fh}`. Null for anything unusable.
   */
  function outlineBox(o, iw, ih) {
    if (!o || typeof o !== 'object' || !(iw > 0 && ih > 0)) return null;
    var x, y, w, h;
    if (typeof o.fx === 'number' && typeof o.fy === 'number' && typeof o.fw === 'number' && typeof o.fh === 'number') {
      x = o.fx * iw; y = o.fy * ih; w = o.fw * iw; h = o.fh * ih;
    } else if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.w === 'number' && typeof o.h === 'number') {
      x = o.x; y = o.y; w = o.w; h = o.h;
    } else {
      return null;
    }
    if (!(isFinite(x) && isFinite(y) && isFinite(w) && isFinite(h)) || w <= 0 || h <= 0) return null;
    // clip to the page
    var x1 = Math.min(iw, x + w), y1 = Math.min(ih, y + h);
    x = Math.max(0, x); y = Math.max(0, y);
    if (x1 <= x || y1 <= y) return null;
    return { x: x, y: y, w: x1 - x, h: y1 - y };
  }

  /* ---------------------------------------------------------------- *
   * DOM
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

  function clampInt(v, lo, hi) {
    v = Math.round(Number(v) || 0);
    return Math.max(lo, Math.min(hi, v));
  }

  /** Resolve a page record to something an <img> or a canvas can show. */
  function loadPage(page) {
    if (!page) return Promise.resolve(null);
    if (page.canvas && page.canvas.getContext) return Promise.resolve({ canvas: page.canvas });
    if (page.blob) return Promise.resolve({ blob: page.blob });
    if (typeof page.src === 'string' && page.src) return Promise.resolve({ src: page.src });
    if (typeof page.load === 'function') {
      return Promise.resolve(page.load()).then(function (r) {
        if (!r) return null;
        if (r.getContext) return { canvas: r };
        if (typeof r === 'string') return { src: r };
        if (typeof Blob !== 'undefined' && r instanceof Blob) return { blob: r };
        return null;
      }, function () { return null; });
    }
    if (page.blobKey && window.BlobStore && typeof window.BlobStore.get === 'function') {
      return window.BlobStore.get(page.blobKey).then(function (b) { return b ? { blob: b } : null; }, function () { return null; });
    }
    return Promise.resolve(null);
  }

  /**
   * @param {HTMLElement} frame   the element the page shows in (sized by the caller's CSS)
   * @param {Object} opts         see the API doc
   */
  function mount(frame, opts) {
    opts = opts || {};
    var pages = Array.isArray(opts.pages) ? opts.pages : [];
    var maxZoom = opts.maxZoom > 1 ? opts.maxZoom : 12;
    var st = { s: 1, tx: 0, ty: 0, iw: 0, ih: 0, fitS: 1 };
    var idx = clampInt(opts.index, 0, Math.max(0, pages.length - 1));
    var url = null, token = 0, destroyed = false;
    var pointers = {}, pinch = null, lastTap = 0;

    frame.classList.add('pv-frame');
    frame.tabIndex = 0;
    frame.setAttribute('role', 'img');
    var stage = el('div', 'pv-stage');
    var img = el('img', 'pv-img');
    img.alt = '';
    img.draggable = false;
    img.hidden = true;
    var cnv = null;
    var mark = el('div', 'pv-mark');
    mark.hidden = true;
    stage.appendChild(img);
    stage.appendChild(mark);
    frame.appendChild(stage);
    var empty = el('div', 'pv-empty');
    empty.hidden = true;
    frame.appendChild(empty);

    function frameSize() {
      var r = frame.getBoundingClientRect();
      return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }

    function apply() {
      stage.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.s + ')';
      if (!mark.hidden) mark.style.borderWidth = Math.max(1, 2.5 / st.s) + 'px';
    }

    function fit() {
      if (!st.iw) return;
      var f = frameSize();
      st.fitS = fitScale(st.iw, st.ih, f.w, f.h);
      st.s = st.fitS;
      clampPan(st, f.w, f.h);
      apply();
    }

    function zoom(factor, mx, my) {
      var f = frameSize();
      zoomAt(st, factor, typeof mx === 'number' ? mx : f.w / 2, typeof my === 'number' ? my : f.h / 2, maxZoom, f.w, f.h);
      apply();
    }

    function lookAt(ix, iy, s) {
      var f = frameSize();
      st.s = Math.max(st.fitS, Math.min(st.fitS * maxZoom, s));
      st.tx = f.w / 2 - ix * st.s;
      st.ty = f.h / 2 - iy * st.s;
      clampPan(st, f.w, f.h);
      apply();
    }

    function label(i) {
      var p = pages[i] || {};
      return (p.label || 'Page ' + (i + 1)) + (pages.length > 1 ? ' · ' + (i + 1) + ' of ' + pages.length : '');
    }

    function placed(w, h) {
      st.iw = w || 1;
      st.ih = h || 1;
      stage.style.width = st.iw + 'px';
      stage.style.height = st.ih + 'px';
      fit();
      var box = typeof opts.outline === 'function' ? outlineBox(opts.outline(idx, { w: st.iw, h: st.ih }), st.iw, st.ih) : null;
      if (box) {
        mark.hidden = false;
        mark.style.left = box.x + 'px';
        mark.style.top = box.y + 'px';
        mark.style.width = box.w + 'px';
        mark.style.height = box.h + 'px';
        var f = frameSize();
        var across = opts.focusZoom > 0 ? opts.focusZoom : 3;
        lookAt(box.x + box.w / 2, box.y + box.h / 2, Math.max(st.fitS * 1.5, Math.min(st.fitS * maxZoom, f.w / (box.w * across))));
      }
      frame.setAttribute('aria-label', (opts.label || 'Page') + ': ' + label(idx) +
        (box ? ', the part you are on is outlined' : '') + '. Pinch or use + and − to zoom, drag or the arrow keys to pan.');
    }

    function revoke() {
      if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } url = null; }
    }

    function show(i) {
      if (destroyed || !pages.length) {
        empty.hidden = false;
        empty.textContent = opts.emptyText || 'No pages to show.';
        return;
      }
      idx = clampInt(i, 0, pages.length - 1);
      var my = ++token;
      mark.hidden = true;
      img.hidden = true;
      if (cnv) cnv.hidden = true;
      empty.hidden = true;
      revoke();
      if (typeof opts.onPage === 'function') { try { opts.onPage(idx); } catch (e) { /* ignore */ } }
      loadPage(pages[idx]).then(function (r) {
        if (my !== token || destroyed) return;
        if (!r) {
          empty.hidden = false;
          var msg = typeof opts.onEmpty === 'function' ? opts.onEmpty(idx) : null;
          empty.textContent = msg || 'That page image is not on this device any more.';
          frame.setAttribute('aria-label', (opts.label || 'Page') + ': ' + label(idx) + ', not available.');
          return;
        }
        if (r.canvas) {
          if (!cnv) {
            cnv = el('canvas', 'pv-img pv-canvas');
            stage.insertBefore(cnv, mark);
          }
          cnv.width = r.canvas.width;
          cnv.height = r.canvas.height;
          var g = cnv.getContext('2d');
          if (g) g.drawImage(r.canvas, 0, 0);
          cnv.hidden = false;
          placed(r.canvas.width, r.canvas.height);
          return;
        }
        if (r.blob) { url = URL.createObjectURL(r.blob); }
        img.onload = function () {
          if (my !== token || destroyed) return;
          img.hidden = false;
          var p = pages[idx] || {};
          placed(img.naturalWidth || p.w, img.naturalHeight || p.h);
        };
        img.onerror = function () {
          if (my !== token || destroyed) return;
          empty.hidden = false;
          empty.textContent = 'That page image could not be shown.';
        };
        img.src = url || r.src;
      });
    }

    /* gestures: drag, pinch, wheel, double-tap, keys */
    function down(e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      try { frame.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]], r = frame.getBoundingClientRect();
        pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s: st.s,
          mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
        pinch.px = (pinch.mx - st.tx) / st.s;
        pinch.py = (pinch.my - st.ty) / st.s;
      }
      e.preventDefault();
    }
    function move(e) {
      var q = pointers[e.pointerId];
      if (!q) return;
      var dx = e.clientX - q.x, dy = e.clientY - q.y;
      q.x = e.clientX; q.y = e.clientY;
      if (Math.abs(e.clientX - q.sx) > MOVE_SLOP || Math.abs(e.clientY - q.sy) > MOVE_SLOP) q.moved = true;
      var ids = Object.keys(pointers);
      var f = frameSize();
      if (ids.length === 2 && pinch) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        st.s = Math.max(st.fitS, Math.min(st.fitS * maxZoom, pinch.s * d / pinch.d));
        st.tx = pinch.mx - pinch.px * st.s;
        st.ty = pinch.my - pinch.py * st.s;
      } else {
        st.tx += dx; st.ty += dy;
      }
      clampPan(st, f.w, f.h);
      apply();
      e.preventDefault();
    }
    function end(e) {
      var q = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!q || q.moved) return;
      var now = Date.now();
      if (now - lastTap < DOUBLE_TAP_MS) {
        lastTap = 0;
        var r = frame.getBoundingClientRect();
        if (st.s > st.fitS * 1.05) fit();
        else zoom(3, e.clientX - r.left, e.clientY - r.top);
        return;
      }
      lastTap = now;
    }
    function wheel(e) {
      e.preventDefault();
      var r = frame.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }
    function key(e) {
      var f = frameSize();
      var k = e.key;
      if (k === '+' || k === '=') zoom(1.25);
      else if (k === '-' || k === '_') zoom(0.8);
      else if (k === 'Home' || k === '0') fit();
      else if (k === 'ArrowLeft') { st.tx += 40; clampPan(st, f.w, f.h); apply(); }
      else if (k === 'ArrowRight') { st.tx -= 40; clampPan(st, f.w, f.h); apply(); }
      else if (k === 'ArrowUp') { st.ty += 40; clampPan(st, f.w, f.h); apply(); }
      else if (k === 'ArrowDown') { st.ty -= 40; clampPan(st, f.w, f.h); apply(); }
      else if (k === 'PageDown' && idx < pages.length - 1) show(idx + 1);
      else if (k === 'PageUp' && idx > 0) show(idx - 1);
      else return;
      e.preventDefault();
    }
    frame.addEventListener('pointerdown', down);
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', end);
    frame.addEventListener('pointercancel', end);
    frame.addEventListener('wheel', wheel, { passive: false });
    frame.addEventListener('keydown', key);

    var viewer = {
      show: show,
      index: function () { return idx; },
      count: function () { return pages.length; },
      label: function () { return label(idx); },
      fit: fit,
      zoom: zoom,
      lookAt: lookAt,
      state: function () { return { s: st.s, tx: st.tx, ty: st.ty, fitS: st.fitS, iw: st.iw, ih: st.ih }; },
      outlined: function () { return !mark.hidden; },
      destroy: function () {
        destroyed = true;
        token++;
        revoke();
        frame.removeEventListener('pointerdown', down);
        frame.removeEventListener('pointermove', move);
        frame.removeEventListener('pointerup', end);
        frame.removeEventListener('pointercancel', end);
        frame.removeEventListener('wheel', wheel);
        frame.removeEventListener('keydown', key);
      }
    };
    if (opts.autoShow !== false) show(idx);
    return viewer;
  }

  /**
   * A sheet with the viewer, ‹ page ›, − Fit +, and room for the craft's own
   * controls (`extra(body, viewer)`, e.g. "Mark page done").
   */
  function open(opts) {
    opts = opts || {};
    var openSheet = opts.openSheet || (window.App && window.App.openSheet) || null;
    if (typeof openSheet !== 'function') return null;
    var viewer = null;
    return openSheet({
      title: opts.title || 'Page',
      cls: 'sheet-pv' + (opts.cls ? ' ' + opts.cls : ''),
      subject: opts.subject,
      build: function (body) {
        var frame = el('div', 'pv-sheet-frame');
        body.appendChild(frame);
        var bar = el('div', 'pv-bar');
        var prev = button('pv-nav', '‹', 'Previous page');
        var lbl = el('span', 'pv-label');
        lbl.setAttribute('aria-live', 'polite');
        var next = button('pv-nav', '›', 'Next page');
        bar.appendChild(prev);
        bar.appendChild(lbl);
        bar.appendChild(next);
        var zoomRow = el('div', 'pv-zoom');
        var zOut = button('btn ghost', '−', 'Zoom out');
        var zFit = button('btn ghost', 'Fit', 'Fit the page');
        var zIn = button('btn ghost', '+', 'Zoom in');
        zoomRow.appendChild(zOut);
        zoomRow.appendChild(zFit);
        zoomRow.appendChild(zIn);
        var userOnPage = opts.onPage;
        var pagesN = Array.isArray(opts.pages) ? opts.pages.length : 0;
        function sync(i) {
          lbl.textContent = (opts.pages[i] && opts.pages[i].label ? opts.pages[i].label : 'Page ' + (i + 1)) +
            (pagesN > 1 ? ' · ' + (i + 1) + ' of ' + pagesN : '');
          prev.disabled = i <= 0;
          next.disabled = i >= pagesN - 1;
          if (typeof userOnPage === 'function') { try { userOnPage(i); } catch (e) { /* ignore */ } }
        }
        if (pagesN > 1 && opts.bar !== false) body.appendChild(bar);
        body.appendChild(zoomRow);
        var o = {};
        for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
        o.onPage = sync;
        o.autoShow = false;
        viewer = mount(frame, o);
        // the bar is right before the first page has loaded
        lbl.textContent = (opts.pages[viewer.index()] && opts.pages[viewer.index()].label) || 'Page ' + (viewer.index() + 1);
        prev.disabled = viewer.index() <= 0;
        next.disabled = viewer.index() >= pagesN - 1;
        prev.addEventListener('click', function () { viewer.show(viewer.index() - 1); });
        next.addEventListener('click', function () { viewer.show(viewer.index() + 1); });
        zOut.addEventListener('click', function () { viewer.zoom(1 / 1.5); });
        zFit.addEventListener('click', function () { viewer.fit(); });
        zIn.addEventListener('click', function () { viewer.zoom(1.5); });
        if (typeof opts.extra === 'function') { try { opts.extra(body, viewer); } catch (e) { /* ignore */ } }
        // after the sheet has laid out, so the frame has its size
        var start = function () { viewer.show(viewer.index()); };
        if (window.requestAnimationFrame) window.requestAnimationFrame(start); else setTimeout(start, 0);
      },
      footer: [{ text: 'Done', cls: 'btn primary', onClick: function (api) { api.close(); } }],
      onClose: function () {
        if (viewer) viewer.destroy();
        if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (e) { /* ignore */ } }
      }
    });
  }

  window.PageViewer = {
    version: VERSION,
    mount: mount,
    open: open,
    fitScale: fitScale,
    clampPan: clampPan,
    zoomAt: zoomAt,
    outlineBox: outlineBox
  };
})();
