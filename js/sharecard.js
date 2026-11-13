/* Thready or Not — js/sharecard.js
 * window.ShareCard : a picture card for a finished or in-progress project
 * (wave K, shell-ui; API in docs/wave-k/api/shell-ui.md §3; brainstorm 00
 * §4.3 and 04 X4).
 *
 * The card is drawn on a canvas on the device — name, craft, the time from
 * the project timer, dates, progress and a picture the craft supplies (the
 * 3D piece for crochet and knitting, a chart thumbnail, a step ring…) — in
 * the colours of the current theme, and exported as a PNG through Web Share
 * when the browser can share files, else as a download. No network: fonts
 * are whatever the page already loaded, and nothing is uploaded anywhere.
 * ES5, one global.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------------------------------------------------------------- *
   * Pure text helpers
   * ---------------------------------------------------------------- */

  function dateText(ms) {
    if (!(typeof ms === 'number' && isFinite(ms) && ms > 0)) return '';
    var d = new Date(ms);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  /** "12 h 5 min", "45 min", "" for nothing timed. */
  function hoursText(ms) {
    if (!(typeof ms === 'number' && isFinite(ms) && ms >= 60000)) return '';
    var mins = Math.floor(ms / 60000);
    var h = Math.floor(mins / 60), m = mins % 60;
    if (!h) return m + ' min';
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }

  function slug(s) {
    var t = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return t || 'project';
  }

  function fileName(info) {
    return 'thready-or-not-' + slug(info && info.name) + '.png';
  }

  /** The lines under the name, in order: craft · status, dates, time, progress. */
  function textLines(info) {
    info = info || {};
    var out = [];
    var craft = info.craft && info.craft.name ? info.craft.name : '';
    var status = info.status === 'finished' ? 'Finished' : info.status === 'frogged' ? 'Frogged'
      : info.status === 'paused' ? 'Paused' : 'In progress';
    out.push((craft ? craft + ' · ' : '') + status);
    var from = dateText(info.startedAt), to = info.status === 'finished' ? dateText(info.finishedAt) : '';
    if (from && to && from !== to) out.push(from + ' – ' + to);
    else if (to) out.push(to);
    else if (from) out.push('Started ' + from);
    var t = hoursText(info.elapsedMs);
    if (t) out.push(t + ' of making');
    if (info.progress && info.progress.text) out.push(String(info.progress.text));
    (Array.isArray(info.lines) ? info.lines : []).forEach(function (l) { if (l) out.push(String(l)); });
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Theme
   * ---------------------------------------------------------------- */

  var FALLBACK = {
    bg: '#fff8ee', surface: '#ffffff', text: '#2b2118', muted: '#6b5a49', primary: '#c8553d',
    primaryText: '#ffffff', accent: '#2f6f73', font: 'Nunito, system-ui, sans-serif',
    display: 'Fredoka, Nunito, system-ui, sans-serif'
  };

  /** The card's colours from the live theme (CSS variables), else a warm default. */
  function theme(style) {
    var cs = style;
    if (!cs) {
      try { cs = window.getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    }
    function v(name, fb) {
      if (!cs || typeof cs.getPropertyValue !== 'function') return fb;
      var x = String(cs.getPropertyValue(name) || '').trim();
      return x || fb;
    }
    return {
      bg: v('--bg', FALLBACK.bg),
      surface: v('--surface', FALLBACK.surface),
      text: v('--text', FALLBACK.text),
      muted: v('--text-muted', FALLBACK.muted),
      primary: v('--primary', FALLBACK.primary),
      primaryText: v('--primary-text', FALLBACK.primaryText),
      accent: v('--accent', FALLBACK.accent),
      font: v('--font-body', FALLBACK.font),
      display: v('--font-display', FALLBACK.display)
    };
  }

  /* ---------------------------------------------------------------- *
   * Drawing
   * ---------------------------------------------------------------- */

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  /** Fit `text` to `maxW` by shrinking from `size` to `min`, then ellipsis. */
  function fitText(g, text, maxW, size, min, weight, family) {
    var s = size;
    for (; s > min; s -= 2) {
      g.font = weight + ' ' + s + 'px ' + family;
      if (g.measureText(text).width <= maxW) return { text: text, size: s };
    }
    g.font = weight + ' ' + min + 'px ' + family;
    var t = String(text);
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return { text: t === text ? t : t + '…', size: min };
  }

  function picSize(p) {
    if (!p) return null;
    var w = p.naturalWidth || p.videoWidth || p.width || 0;
    var h = p.naturalHeight || p.videoHeight || p.height || 0;
    return w > 0 && h > 0 ? { w: w, h: h } : null;
  }

  /**
   * Draw the card. Square, `size` px a side (default 1080). The picture is
   * drawn contained (never cropped) in a rounded frame; without one the
   * project's emoji stands in, big.
   * @returns {HTMLCanvasElement}
   */
  function draw(canvas, info, opts) {
    info = info || {};
    opts = opts || {};
    var S = Math.max(320, Math.min(2048, Math.round(opts.size || 1080)));
    var th = opts.theme || theme(null);
    canvas.width = S;
    canvas.height = S;
    var g = canvas.getContext('2d');
    if (!g) return canvas;
    var u = S / 1080;   // design units: the layout is drawn for 1080 and scaled

    // background and a soft band in the theme's primary
    g.fillStyle = th.bg;
    g.fillRect(0, 0, S, S);
    g.fillStyle = th.primary;
    g.globalAlpha = 0.14;
    g.beginPath();
    g.arc(S * 0.92, S * 0.06, S * 0.42, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(S * 0.02, S * 0.98, S * 0.3, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    // the picture frame
    var pad = 64 * u;
    var fx = pad, fy = pad, fw = S - pad * 2, fh = 600 * u;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.18)';
    g.shadowBlur = 30 * u;
    g.shadowOffsetY = 8 * u;
    g.fillStyle = th.surface;
    roundRect(g, fx, fy, fw, fh, 36 * u);
    g.fill();
    g.restore();
    g.save();
    roundRect(g, fx, fy, fw, fh, 36 * u);
    g.clip();
    var pic = info.picture || null;
    var ps = picSize(pic);
    if (ps) {
      var inner = 24 * u;
      var k = Math.min((fw - inner * 2) / ps.w, (fh - inner * 2) / ps.h);
      var dw = ps.w * k, dh = ps.h * k;
      try {
        g.drawImage(pic, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh);
      } catch (e) {
        ps = null;   // a tainted or detached source: fall back to the emoji
      }
    }
    if (!ps) {
      g.fillStyle = th.text;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = Math.round(300 * u) + 'px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      g.fillText(info.emoji || (info.craft && info.craft.emoji) || '🧶', fx + fw / 2, fy + fh / 2 + 10 * u);
    }
    g.restore();

    // a progress bar under the frame
    var y = fy + fh + 40 * u;
    var pct = info.progress && typeof info.progress.pct === 'number' && isFinite(info.progress.pct)
      ? Math.max(0, Math.min(1, info.progress.pct)) : null;
    if (info.status === 'finished') pct = 1;
    if (pct !== null) {
      g.fillStyle = th.surface;
      roundRect(g, pad, y, S - pad * 2, 18 * u, 9 * u);
      g.fill();
      if (pct > 0) {
        g.fillStyle = th.accent;
        roundRect(g, pad, y, Math.max(18 * u, (S - pad * 2) * pct), 18 * u, 9 * u);
        g.fill();
      }
      y += 18 * u + 34 * u;
    } else {
      y += 16 * u;
    }

    // the name, then the lines
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = th.text;
    var name = String(info.name || 'My project');
    var nm = fitText(g, name, S - pad * 2, Math.round(84 * u), Math.round(44 * u), '700', th.display);
    g.font = '700 ' + nm.size + 'px ' + th.display;
    y += nm.size * 0.9;
    g.fillText(nm.text, pad, y);
    y += 22 * u;

    var lines = textLines(info);
    g.fillStyle = th.muted;
    var ls = Math.round(36 * u);
    for (var i = 0; i < lines.length && y + ls < S - 70 * u; i++) {
      var ft = fitText(g, lines[i], S - pad * 2, ls, Math.round(26 * u), i === 0 ? '700' : '600', th.font);
      g.font = (i === 0 ? '700 ' : '600 ') + ft.size + 'px ' + th.font;
      y += ft.size * 1.3;
      g.fillText(ft.text, pad, y);
    }

    // the maker's credit line, bottom right
    g.textAlign = 'right';
    g.fillStyle = th.muted;
    g.globalAlpha = 0.85;
    g.font = '700 ' + Math.round(26 * u) + 'px ' + th.display;
    g.fillText('🧶 Thready or Not', S - pad, S - 36 * u);
    g.globalAlpha = 1;
    return canvas;
  }

  /* ---------------------------------------------------------------- *
   * Export
   * ---------------------------------------------------------------- */

  function toBlob(canvas) {
    return new Promise(function (resolve) {
      try {
        if (canvas.toBlob) {
          canvas.toBlob(function (b) { resolve(b || null); }, 'image/png');
          return;
        }
        var url = canvas.toDataURL('image/png');
        var bin = atob(url.split(',')[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: 'image/png' }));
      } catch (e) {
        resolve(null);
      }
    });
  }

  function download(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      }, 1500);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Can this browser share an image file through the share sheet? */
  function canShareFiles(file) {
    try {
      return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (e) {
      return false;
    }
  }

  /**
   * Web Share with the PNG where the browser can share files, else a
   * download. Resolves 'shared' | 'downloaded' | 'cancelled' | 'failed'.
   */
  function share(blob, opts) {
    opts = opts || {};
    if (!blob) return Promise.resolve('failed');
    var name = opts.filename || 'thready-or-not.png';
    var file = null;
    try { file = new File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }
    if (file && !opts.download && canShareFiles(file)) {
      return navigator.share({ files: [file], title: opts.title || '', text: opts.text || '' })
        .then(function () { return 'shared'; }, function (err) {
          if (err && err.name === 'AbortError') return 'cancelled';
          return download(blob, name) ? 'downloaded' : 'failed';
        });
    }
    return Promise.resolve(download(blob, name) ? 'downloaded' : 'failed');
  }

  /**
   * The picture from a live 3D handle (js/diagram.js `handle.snapshot`, knit-3d
   * wave K): one frame drawn synchronously and cropped to the piece, so it
   * works on a hidden page. Null when the handle has no snapshot (an older
   * renderer, the 2D fallback) or nothing was drawn — the caller then falls
   * back to its own frame copy, or the card shows the project's emoji.
   */
  function snapshot(handle, opts) {
    opts = opts || {};
    if (!handle || typeof handle.snapshot !== 'function') return null;
    try {
      if (typeof handle.finishBake === 'function') handle.finishBake();
      return handle.snapshot({
        size: opts.size || 900, crop: opts.crop !== false,
        pad: typeof opts.pad === 'number' ? opts.pad : 0.06, background: opts.background || null
      }) || null;
    } catch (e) {
      return null;
    }
  }

  window.ShareCard = {
    version: VERSION,
    snapshot: snapshot,
    theme: theme,
    draw: draw,
    toBlob: toBlob,
    share: share,
    download: download,
    canShareFiles: canShareFiles,
    fileName: fileName,
    textLines: textLines,
    hoursText: hoursText,
    dateText: dateText
  };
})();
