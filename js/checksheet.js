/* Thready or Not — js/checksheet.js
 * window.CheckSheet : one sheet and one badge style for "what the pattern
 * prints against what the app read" (wave K, shell-ui; API in
 * docs/wave-k/api/shell-ui.md §2).
 *
 *   Check = { verdict: 'exact'|'close'|'off'|'unchecked', summary, title?, note?,
 *             rows: [{ label, printed, read, verdict, why, page, hex? }] }
 *   row verdicts: 'exact' ✓ · 'computed' / 'close' ≈ · 'off' ≠ · 'unknown' ?
 *
 * Crochet's count report feeds it now (`fromCountReport`); cross-stitch's
 * wave J check (`fromXStitch`, the key against the grid or picture),
 * sewing's "what was missed" and knitting's "count unknown" feed it in
 * batch 2. A verdict of "off" demotes the primary button behind a plain
 * confirm (`demote` / `guard`): never a block, never hidden (BUILD.md).
 *
 * Pure functions plus small DOM builders; the sheet itself is opened with
 * the shell's `openSheet`, handed in (this file loads before js/app.js).
 * ES5, one global.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var VERDICTS = ['exact', 'close', 'off', 'unchecked'];
  var ROW_VERDICTS = ['exact', 'computed', 'close', 'off', 'unknown'];
  /** The share of counted rows that must disagree before a crochet check is "off". */
  var OFF_SHARE = 0.2;

  var GLYPH = { exact: '✓', computed: '≈', close: '≈', off: '≠', unknown: '?', unchecked: '?' };
  var CLS = { exact: 'check-exact', computed: 'check-approx', close: 'check-approx', off: 'check-off',
    unknown: 'check-unknown', unchecked: 'check-unknown' };
  var WORD = {
    exact: 'matches', computed: 'worked out by the app', close: 'close', off: 'disagrees',
    unknown: 'nothing printed to check', unchecked: 'not checked'
  };

  function str(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\s+/g, ' ').trim();
    return max && s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return n === null || n === undefined ? '' : str(n, 60);
    var v = Math.round(n * 100) / 100;
    var s = String(Math.abs(v));
    var parts = s.split('.');
    if (parts[0].length > 3) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '−' : '') + parts.join('.');
  }

  function plural(n, word) {
    return fmt(n) + ' ' + word + (n === 1 ? '' : 's');
  }

  /* ---------------------------------------------------------------- *
   * The shape
   * ---------------------------------------------------------------- */

  function normRow(r) {
    if (!r || typeof r !== 'object') return null;
    var v = ROW_VERDICTS.indexOf(r.verdict) >= 0 ? r.verdict
      : (r.verdict === 'unchecked' ? 'unknown' : (r.ok === true ? 'exact' : r.ok === false ? 'off' : 'unknown'));
    var num = function (x) {
      if (typeof x === 'number' && isFinite(x)) return x;
      if (typeof x === 'string' && x.trim()) return str(x, 80);
      return null;
    };
    var page = typeof r.page === 'number' && isFinite(r.page) && r.page >= 1 ? Math.floor(r.page) : null;
    var out = { label: str(r.label, 120) || '—', printed: num(r.printed), read: num(r.read), verdict: v,
      why: str(r.why, 600), page: page };
    if (typeof r.hex === 'string' && /^#[0-9a-f]{3,8}$/i.test(r.hex)) out.hex = r.hex;
    return out;
  }

  /** Any value in, a Check out (never throws). */
  function normalize(check) {
    var c = check && typeof check === 'object' ? check : {};
    var rows = Array.isArray(c.rows) ? c.rows.map(normRow).filter(Boolean) : [];
    var verdict = VERDICTS.indexOf(c.verdict) >= 0 ? c.verdict : verdictOf(rows);
    var out = { verdict: verdict, summary: str(c.summary, 400) || summaryOf(verdict, rows), rows: rows };
    if (c.title) out.title = str(c.title, 80);
    if (c.note) out.note = str(c.note, 400);
    return out;
  }

  /** A whole-check verdict from its rows (used when the producer gives none). */
  function verdictOf(rows) {
    if (!rows || !rows.length) return 'unchecked';
    var off = 0, approx = 0, exact = 0;
    rows.forEach(function (r) {
      if (r.verdict === 'off') off++;
      else if (r.verdict === 'computed' || r.verdict === 'close') approx++;
      else if (r.verdict === 'exact') exact++;
    });
    if (off) return 'off';
    if (approx) return 'close';
    if (exact) return 'exact';
    return 'unchecked';
  }

  function summaryOf(verdict, rows) {
    var n = rows ? rows.length : 0;
    if (verdict === 'exact') return n ? 'Everything matches what the pattern prints.' : 'Everything matches.';
    if (verdict === 'off') {
      var off = rows.filter(function (r) { return r.verdict === 'off'; }).length;
      return plural(off, 'line') + ' disagree' + (off === 1 ? 's' : '') + ' with what the pattern prints.';
    }
    if (verdict === 'close') return 'Close: some numbers were worked out by the app (≈).';
    return 'Nothing printed to check against.';
  }

  function glyph(v) {
    return GLYPH[v] || '?';
  }

  /* ---------------------------------------------------------------- *
   * Adaptors
   * ---------------------------------------------------------------- */

  /**
   * Crochet / knitting: `Store.countReport(part)` → Check. Counts are per row
   * ("Rnd 7-13" is seven). `lines` (optional, the part's parsed Line list)
   * gives one table row per counted pattern line; without it the table is
   * the report's totals plus every disagreement.
   * @param {{rows,printed,computed,missing,unresolved,disagree:[{row,rowEnd,printed,computed,text}]}} rep
   * @param {{word?: string, name?: string, lines?: Array, craft?: string}} [opts]
   */
  function fromCountReport(rep, opts) {
    opts = opts || {};
    var word = str(opts.word || 'row').toLowerCase() || 'row';
    var Word = word.charAt(0).toUpperCase() + word.slice(1);
    var r = rep && typeof rep === 'object' ? rep : {};
    var total = Number(r.rows) || 0;
    var dis = Array.isArray(r.disagree) ? r.disagree : [];
    var rows = [];
    if (Array.isArray(opts.lines) && opts.lines.length) {
      opts.lines.forEach(function (l) {
        if (!l || l.kind !== 'row' || !(l.row >= 1)) return;
        var end = l.rowEnd === null || l.rowEnd === undefined ? l.row : l.rowEnd;
        var label = Word + ' ' + l.row + (end > l.row ? '–' + end : '');
        var v, why = '', printed = null, read = null;
        if (l.sizeUnresolved) {
          v = 'unknown';
          why = 'The pattern lists numbers that are not one per size here, so no count is set.';
        } else if (l.deviation) {
          v = 'off';
          printed = l.deviation.printed;
          read = l.deviation.computed;
          why = 'The pattern prints ' + l.deviation.printed + '; its own instructions add up to ' +
            l.deviation.computed + '. The printed number is kept — check this ' + word + '.';
        } else if (l.countSource === 'explicit') {
          v = 'exact';
          printed = typeof l.count === 'number' ? l.count : null;
          read = printed;
        } else if (l.countSource === 'computed') {
          v = 'computed';
          read = typeof l.count === 'number' ? l.count : null;
          why = 'No count printed; worked out from the instructions (≈).';
        } else {
          v = 'unknown';
          why = 'count unknown — the pattern prints none and the instructions do not add up to one.';
        }
        rows.push({ label: label, printed: printed, read: read, verdict: v, why: why, page: typeof l.page === 'number' ? l.page : null });
      });
    } else {
      dis.forEach(function (d) {
        var end = d.rowEnd === null || d.rowEnd === undefined ? d.row : d.rowEnd;
        rows.push({
          label: Word + ' ' + d.row + (end > d.row ? '–' + end : ''), printed: d.printed, read: d.computed, verdict: 'off',
          why: 'The pattern prints ' + d.printed + '; its own instructions add up to ' + d.computed +
            '. The printed number is kept — check this ' + word + '.'
        });
      });
    }
    var disRows = 0;
    dis.forEach(function (d) {
      var end = d.rowEnd === null || d.rowEnd === undefined ? d.row : d.rowEnd;
      disRows += Math.max(1, end - d.row + 1);
    });
    var verdict;
    if (!total) verdict = 'unchecked';
    else if (disRows && disRows >= OFF_SHARE * total) verdict = 'off';
    else if (disRows || r.computed || r.missing || r.unresolved) verdict = 'close';
    else verdict = 'exact';
    if (verdict === 'close' && !disRows && !r.computed && (r.missing || r.unresolved) && !r.printed) verdict = 'unchecked';
    var bits = [];
    if (total) bits.push(plural(total, word));
    if (r.printed) bits.push(fmt(r.printed) + ' printed');
    if (r.computed) bits.push(fmt(r.computed) + ' computed ≈');
    if (r.missing) bits.push(fmt(r.missing) + ' count unknown');
    if (r.unresolved) bits.push(fmt(r.unresolved) + ' not given for your size');
    if (dis.length) bits.push(dis.length + (dis.length === 1 ? ' count disagrees' : ' counts disagree') + ' with the pattern');
    return normalize({
      verdict: verdict,
      title: (opts.name ? opts.name + ': ' : '') + 'counts against the pattern',
      summary: bits.length ? bits.join(' · ') : 'No counted ' + word + 's.',
      rows: rows,
      note: 'Printed: the count in the pattern. Read: what the app reads or works out from the instructions.'
    });
  }

  /**
   * Cross-stitch (wave J contract §3): `XSRead.read(...).check` /
   * `XStitch.checkCounts(...)` → Check.
   */
  function fromXStitch(xs) {
    var c = xs && typeof xs === 'object' ? xs : {};
    var rows = (Array.isArray(c.rows) ? c.rows : []).map(function (r) {
      if (!r) return null;
      var label = [r.brand && r.code ? r.brand + ' ' + r.code : (r.code || ''), r.name || ''].filter(Boolean).join(' · ') || 'Colour';
      var v;
      if (r.expected === null || r.expected === undefined) v = 'unknown';
      else if (r.read === r.expected) v = 'exact';
      else if (r.ok) v = 'close';
      else v = 'off';
      var why = '';
      if (v === 'off') why = 'The key prints ' + fmt(r.expected) + ' stitches; the chart reads ' + fmt(r.read || 0) + '.';
      else if (v === 'close') why = 'Within the tolerance (off by ' + fmt(Math.abs((r.read || 0) - r.expected)) + ').';
      else if (v === 'unknown') why = 'The key prints no count for this colour.';
      return { label: label, printed: r.expected === undefined ? null : r.expected, read: r.read, verdict: v, why: why, hex: r.hex };
    }).filter(Boolean);
    var unk = Array.isArray(c.unmatchedEntries) ? c.unmatchedEntries.length : 0;
    var verdict = VERDICTS.indexOf(c.verdict) >= 0 ? c.verdict : verdictOf(rows);
    return normalize({
      verdict: verdict,
      title: 'Chart against the key',
      summary: c.summary || summaryOf(verdict, rows),
      rows: rows,
      note: (unk ? plural(unk, 'key colour') + ' found no stitches. ' : '') +
        (c.unmatchedClasses ? plural(c.unmatchedClasses, 'colour') + ' on the chart ' +
          (c.unmatchedClasses === 1 ? 'matches' : 'match') + ' no key row. ' : '') +
        'Printed: the key’s stitch count. Read: stitches found on the chart.'
    });
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

  /** The one badge: ✓ ≈ ≠ ? in its colour, with a spoken label. */
  function badge(verdict, opts) {
    opts = opts || {};
    var v = GLYPH[verdict] ? verdict : 'unknown';
    var b = el('span', 'check-badge ' + CLS[v], GLYPH[v]);
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', opts.label || WORD[v]);
    b.title = opts.label || WORD[v];
    return b;
  }

  /** Summary + table into `container` (cleared first). */
  function render(container, check, opts) {
    opts = opts || {};
    var c = normalize(check);
    while (container.firstChild) container.removeChild(container.firstChild);
    container.classList.add('check-sheet');
    var head = el('div', 'check-head check-v-' + c.verdict);
    head.appendChild(badge(c.verdict));
    head.appendChild(el('p', 'check-summary', c.summary));
    container.appendChild(head);
    if (c.verdict === 'off') {
      container.appendChild(el('p', 'check-off-note',
        'Something here does not match. You can still use it — check the lines marked ≠ first.'));
    }
    var max = typeof opts.maxRows === 'number' ? opts.maxRows : 400;
    // disagreements first, then unknown, then the rest, each in their own order
    var order = { off: 0, unknown: 1, computed: 2, close: 2, exact: 3 };
    var rows = c.rows.map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return (order[a.r.verdict] - order[b.r.verdict]) || (a.i - b.i); })
      .map(function (x) { return x.r; });
    if (rows.length) {
      var table = el('table', 'check-table');
      var thead = el('thead');
      var hr = el('tr');
      ['', 'What', 'Printed', 'Read'].forEach(function (h, i) {
        var th = el('th', i === 0 ? 'check-col-badge' : null, h);
        th.setAttribute('scope', 'col');
        if (i === 0) { th.appendChild(el('span', 'sr-only', 'Verdict')); }
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = el('tbody');
      rows.slice(0, max).forEach(function (r) {
        var tr = el('tr', 'check-row check-row-' + r.verdict);
        var tdB = el('td', 'check-col-badge');
        tdB.appendChild(badge(r.verdict));
        tr.appendChild(tdB);
        var tdL = el('td', 'check-col-label');
        if (r.hex) {
          var sw = el('span', 'check-swatch');
          sw.style.background = r.hex;
          sw.setAttribute('aria-hidden', 'true');
          tdL.appendChild(sw);
        }
        tdL.appendChild(el('span', 'check-label', r.label));
        if (r.why) tdL.appendChild(el('span', 'check-why', r.why));
        if (r.page && typeof opts.onPage === 'function') {
          var pg = el('button', 'linkish check-page', '📄 page ' + r.page);
          pg.type = 'button';
          pg.setAttribute('aria-label', 'Open page ' + r.page);
          pg.addEventListener('click', function () { opts.onPage(r.page, r); });
          tdL.appendChild(pg);
        } else if (r.page) {
          tdL.appendChild(el('span', 'check-why', 'page ' + r.page));
        }
        tr.appendChild(tdL);
        tr.appendChild(el('td', 'check-col-num', r.printed === null ? '—' : fmt(r.printed)));
        tr.appendChild(el('td', 'check-col-num', r.read === null ? '—' : fmt(r.read)));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      var wrap = el('div', 'check-table-wrap');
      wrap.appendChild(table);
      container.appendChild(wrap);
      if (rows.length > max) container.appendChild(el('p', 'muted check-more', plural(rows.length - max, 'more line') + ' not shown.'));
    }
    if (c.note) container.appendChild(el('p', 'muted check-note', c.note));
    return container;
  }

  /** One line for a preview: badge, summary, "See the check". */
  function line(check, opts) {
    opts = opts || {};
    var c = normalize(check);
    var row = el('div', 'check-line check-v-' + c.verdict);
    row.appendChild(badge(c.verdict));
    row.appendChild(el('span', 'check-line-text', c.summary));
    if (typeof opts.onOpen === 'function' && (c.rows.length || c.note)) {
      var b = el('button', 'linkish check-open', opts.openText || 'See the check');
      b.type = 'button';
      b.addEventListener('click', function (e) { e.stopPropagation(); opts.onOpen(c); });
      row.appendChild(b);
    }
    return row;
  }

  /** The sheet, through the shell's openSheet (ctx.openSheet / App's own). */
  function open(check, opts) {
    opts = opts || {};
    var c = normalize(check);
    var openSheet = opts.openSheet || (window.App && window.App.openSheet) || null;
    if (typeof openSheet !== 'function') return null;
    return openSheet({
      title: opts.title || c.title || 'The check',
      cls: 'sheet-check',
      subject: opts.subject,
      build: function (body) { render(body, c, { onPage: opts.onPage, maxRows: opts.maxRows }); },
      footer: [{ text: 'OK', cls: 'btn primary', onClick: function (api) { api.close(); } }]
    });
  }

  /**
   * Resolves true at once unless the check is "off"; then asks the user
   * through `confirmFn({title, message, confirmText, cancelText})` (the
   * shell's confirmSheet) and resolves with their answer.
   */
  function guard(check, confirmFn, opts) {
    opts = opts || {};
    var c = normalize(check);
    if (c.verdict !== 'off') return Promise.resolve(true);
    if (typeof confirmFn !== 'function') return Promise.resolve(true);
    var res;
    try {
      res = confirmFn({
        title: opts.title || 'Use it anyway?',
        message: (opts.message || c.summary) + ' You can still use it and fix it afterwards.',
        confirmText: opts.confirmText || 'Use it anyway',
        cancelText: opts.cancelText || 'Go back and check'
      });
    } catch (e) {
      return Promise.resolve(true);
    }
    return Promise.resolve(res).then(function (ok) { return !!ok; }, function () { return false; });
  }

  /**
   * "Off" demotes a primary button: it loses `.primary`, gains
   * `.check-demoted` and a description saying why. Returns
   * `{ set(check), guard(confirmFn) → Promise<boolean>, isDemoted() }`.
   */
  function demote(btn, check) {
    var cur = normalize(check);
    var wasPrimary = !!(btn && btn.classList && btn.classList.contains('primary'));
    function apply() {
      if (!btn || !btn.classList) return;
      var off = cur.verdict === 'off';
      if (off) {
        btn.classList.remove('primary');
        btn.classList.add('check-demoted');
        btn.setAttribute('aria-description', 'The check disagrees: ' + cur.summary);
      } else {
        if (wasPrimary) btn.classList.add('primary');
        btn.classList.remove('check-demoted');
        btn.removeAttribute('aria-description');
      }
    }
    apply();
    return {
      set: function (c) { cur = normalize(c); apply(); },
      guard: function (confirmFn, opts) { return guard(cur, confirmFn, opts); },
      isDemoted: function () { return cur.verdict === 'off'; },
      check: function () { return cur; }
    };
  }

  window.CheckSheet = {
    version: VERSION,
    OFF_SHARE: OFF_SHARE,
    normalize: normalize,
    verdictOf: verdictOf,
    glyph: glyph,
    badge: badge,
    render: render,
    line: line,
    open: open,
    guard: guard,
    demote: demote,
    fromCountReport: fromCountReport,
    fromXStitch: fromXStitch
  };
})();
