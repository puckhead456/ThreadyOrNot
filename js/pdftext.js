/* Thready or Not — js/pdftext.js
 * window.PdfText : pull plain text out of a pattern PDF, on-device.
 *
 * Uses the vendored pdf.js 3.11.174 UMD build, loaded lazily on first use so
 * the 300KB library never costs anything to people who only paste text. Both
 * the library and its worker are precached by the service worker, so once the
 * app has been installed this works with no network at all.
 *
 *   PdfText.extract(file, { onProgress(page, total) })
 *     → Promise<{ text, pages, chars, columnsDetected }>
 *   PdfText.isAvailable() → boolean
 *
 * The output is aimed squarely at window.Patterns: one line per printed line,
 * two-column pages untangled into left block then right block, ligature splits
 * repaired, page furniture dropped and `=== PAGE n ===` markers in between.
 */
(function () {
  'use strict';

  /* Resolve the vendor files relative to THIS script (js/pdftext.js), not the
   * page, so the reader works from any page depth (app root, test pages). */
  var SCRIPT_BASE = (function () {
    try {
      var cur = document.currentScript && document.currentScript.src;
      if (cur) return cur.replace(/[^\/]*$/, '');
    } catch (e) { /* fall through */ }
    return './js/';
  })();
  var LIB_SRC = SCRIPT_BASE + 'vendor/pdf.min.js';
  var WORKER_SRC = SCRIPT_BASE + 'vendor/pdf.worker.min.js';

  /* Line grouping: items whose baselines are this close are the same line. */
  var Y_TOLERANCE = 2.5;
  /* Column detection */
  var MIN_LINES_FOR_COLUMNS = 12;   // short pages are never two columns
  var MIN_GAP_WIDTH = 14;           // the clear band has to be this wide
  var BAND_LO = 0.30;               // ...and sit between 30%
  var BAND_HI = 0.70;               // ...and 70% of the region width
  var MAX_CROSSING = 0.30;          // at most 30% of lines may bridge the band
  var MIN_COLUMN_LINES = 3;         // both sides must hold real content
  var MIN_COLUMN_SHARE = 0.15;
  var MAX_COLUMNS = 3;
  var MARGIN_BAND = 0.08;           // top/bottom slice that holds running heads

  var LIGATURES = /^(?:fi|fl|ff|ffi|ffl)$/;

  /* Letter-spaced pages. Some generators draw every glyph with its own
   * kerning step, wide enough that pdf.js turns each step into a space, so a
   * whole line arrives as "R 2 : s c i n c x 6 ( 1 2 )". The *word* breaks
   * survive that treatment as items of their own (a whitespace-only item, or
   * simply a new item), so the repair is to drop the spaces INSIDE an item
   * and keep the ones BETWEEN items: "R2: sc inc x6 (12)".
   * An item is only rewritten when it is nothing but single glyphs separated
   * by single spaces, and only on a page that looks letter-spaced as a whole
   * (see pageLooksSpaced) - a lone "A B C" photo label in an ordinary PDF
   * keeps its spaces. */
  var SPACED_ITEM_RE = /^\S(?: \S)+$/;
  var MIN_SPACED_ROWS = 3;      // a page needs this many letter-spaced lines
  var MIN_SPACED_SHARE = 0.4;   // ...and they must be this share of its lines

  /* Diagram callouts. Text drawn on top of a photo or a sketch ("Arm goes
   * here", "4 sc between", "5 4 3 2 1", "Eye placement") arrives in the same
   * text stream as the pattern. Left in, the importer hangs it off the row
   * above as a note, or shows it as a loose line in the middle of a part.
   * Three geometric signals tell a callout from prose, none of which needs a
   * word list (which would only ever fit one pattern):
   *   a) it is drawn rotated - a callout points at the thing it labels;
   *   b) it is set much smaller than the page's body text;
   *   c) it floats - a short run of lines cut off from the rest of its column
   *      by a vertical gap several times the column's own line pitch.
   * (a) is handled by dropRotated(), (b) and (c) together by labelRows(). */
  var MAX_ROTATED_SHARE = 0.2;  // a page set sideways is landscape, not art
  var LABEL_GAP_FACTOR = 3;     // "cut off" = this many line pitches away
  var LABEL_MAX_LINES = 6;      // a caption is a few lines at most
  var LABEL_MAX_WORDS = 6;
  var LABEL_MAX_CHARS = 48;
  var LABEL_SMALL_FONT = 0.8;   // "much smaller" = this share of body text
  var LABEL_BIG_FONT = 1.1;     // ...and anything bigger is a heading
  var MIN_ROWS_FOR_LABELS = 4;  // nothing to compare against on a short page

  var libPromise = null;
  var libFailed = false;

  /* ================================================================== *
   * 1. Lazy library loading
   * ================================================================== */

  function configure(lib) {
    try {
      if (lib && lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
    } catch (e) {
      /* worker config is best-effort; pdf.js falls back to the fake worker */
    }
    return lib;
  }

  function loadLib() {
    if (window.pdfjsLib) return Promise.resolve(configure(window.pdfjsLib));
    if (libPromise) return libPromise;

    libPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = LIB_SRC;
      script.async = true;
      script.onload = function () {
        if (window.pdfjsLib) {
          resolve(configure(window.pdfjsLib));
        } else {
          libFailed = true;
          libPromise = null;
          reject(new Error('The PDF reader loaded but did not start up.'));
        }
      };
      script.onerror = function () {
        libFailed = true;
        libPromise = null;
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('Couldn’t load the PDF reader. Open the app online once, then it works offline.'));
      };
      (document.head || document.documentElement).appendChild(script);
    });
    return libPromise;
  }

  /** False only once we know for sure the library will not load. */
  function isAvailable() {
    if (window.pdfjsLib) return true;
    return !libFailed;
  }

  /* ================================================================== *
   * 2. Text helpers
   * ================================================================== */

  function collapse(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /**
   * Belt-and-braces ligature repair for PDFs that hand us the ligature glyph
   * with its own spaces baked in ("the fi rst" → "the first"). The primary fix
   * happens while items are joined (a lone `fi` item never gets a space).
   */
  function fixLigatures(line) {
    return line.replace(/(^|\s)(fi|fl|ff|ffi|ffl) ([a-z])/g, '$1$2$3');
  }

  var FURNITURE = [
    /^\d{1,4}$/,                                  // 7
    /^\d{1,4}\s*(?:of|\/)\s*\d{1,4}$/i,           // 3 of 6
    /^page\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i,
    /^[-–—•|]+\s*\d{1,4}\s*[-–—•|]+$/,            // - 4 -
    /^[A-Z](?:\s+[A-Z])*$/,                       // photo labels: A / E F / I J K
    /all\s+rights\s+reserved/i,
    /^[©@(]?\s*(?:c|©)?\s*(?:copyright)?\s*\(?\s*[©c]?\s*\)?\s*(?:19|20)\d{2}\b/i
  ];

  function isFurniture(line) {
    if (!line) return true;
    if (line.indexOf('©') >= 0) return true;
    for (var i = 0; i < FURNITURE.length; i++) {
      if (FURNITURE[i].test(line)) return true;
    }
    return false;
  }

  /* ================================================================== *
   * 3. Per-page line reconstruction
   * ================================================================== */

  /**
   * Is this item drawn sideways? `transform` is [a b c d e f] and [a, b] is
   * the direction its baseline runs in, so upright text has b at (or very
   * near) zero. Callouts are turned to point at the piece they name ("Arm
   * goes here" written up the side of a photo).
   */
  function isRotated(it) {
    var t = it && it.transform;
    if (!t || t.length < 6) return false;
    return Math.abs(t[1]) > Math.abs(t[0]) * 0.1;
  }

  /**
   * Drop the sideways items - unless most of the page is sideways, in which
   * case the whole page is simply typeset that way and all of it is real.
   */
  function dropRotated(items) {
    var rotChars = 0, allChars = 0, i, n;
    for (i = 0; i < items.length; i++) {
      if (!items[i] || typeof items[i].str !== 'string') continue;
      n = items[i].str.replace(/\s/g, '').length;
      allChars += n;
      if (isRotated(items[i])) rotChars += n;
    }
    if (!rotChars || rotChars > allChars * MAX_ROTATED_SHARE) return items;
    return items.filter(function (it) { return !isRotated(it); });
  }

  /**
   * Group a page's text items into rows by their baseline Y.
   * @returns {Array<{y:number, items:Array<{x:number,end:number,h:number,str:string}>}>}
   */
  function buildRows(items) {
    items = dropRotated(items || []);
    var rows = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string' || !it.str.length) continue;
      if (!it.transform || it.transform.length < 6) continue;
      var x = it.transform[4];
      var y = it.transform[5];
      var w = typeof it.width === 'number' && isFinite(it.width) ? it.width : 0;
      var h = typeof it.height === 'number' && isFinite(it.height) && it.height > 0
        ? it.height
        : Math.abs(it.transform[3]) || 10;
      var row = null;
      for (var r = rows.length - 1; r >= 0; r--) {
        if (Math.abs(rows[r].y - y) <= Y_TOLERANCE) { row = rows[r]; break; }
      }
      if (!row) {
        row = { y: y, items: [] };
        rows.push(row);
      }
      row.items.push({ x: x, end: x + w, h: h, str: it.str });
    }
    rows.sort(function (a, b) { return b.y - a.y; });
    rows.forEach(function (row) {
      row.items.sort(function (a, b) { return a.x - b.x; });
    });
    return rows.filter(function (row) { return row.items.length > 0; });
  }

  /** How many of a row's items carry ink, and how many are spaced-out glyphs? */
  function spacedTally(row) {
    var solid = 0, spaced = 0;
    for (var i = 0; i < row.items.length; i++) {
      var s = row.items[i].str;
      if (!s || !s.replace(/\s/g, '')) continue;    // a word-gap item, no ink
      solid++;
      if (SPACED_ITEM_RE.test(s)) spaced++;
    }
    return { solid: solid, spaced: spaced };
  }

  /**
   * Letter spacing is a property of a page's typesetting, not of one line, so
   * the decision is made per page: several lines have to look spaced out AND
   * be a decent share of the page before any item is rewritten. That keeps a
   * stray "A B C" label or a spaced-out colour code in an ordinary PDF (the
   * cross-stitch and sewing importers read the same output) untouched.
   */
  function pageLooksSpaced(rows) {
    var candidates = 0, spaced = 0;
    for (var i = 0; i < rows.length; i++) {
      var t = spacedTally(rows[i]);
      if (t.solid < 2) continue;                    // one-word lines say nothing
      candidates++;
      if (t.spaced >= 2 && t.spaced * 2 >= t.solid) spaced++;
    }
    return spaced >= MIN_SPACED_ROWS && spaced >= candidates * MIN_SPACED_SHARE;
  }

  /**
   * Join one row's items into a single line of text.
   * @param {boolean} [deglyph] true on a letter-spaced page: strip the spaces
   *   that sit between the single glyphs of one item (see SPACED_ITEM_RE).
   */
  function rowText(row, deglyph) {
    var out = '';
    var prev = null;
    for (var i = 0; i < row.items.length; i++) {
      var it = row.items[i];
      var str = it.str;
      if (deglyph && SPACED_ITEM_RE.test(str)) str = str.replace(/ /g, '');
      var lig = LIGATURES.test(str.trim());
      if (prev) {
        var glued =
          lig ||                                    // ligature glyph: part of a word
          LIGATURES.test(prev.str.trim()) ||
          /\s$/.test(prev.str) ||                   // the space is already in the text
          /^\s/.test(str) ||
          it.x - prev.end < 0.15 * Math.max(prev.h, it.h);  // glyphs are touching
        if (!glued) out += ' ';
      }
      out += str;
      prev = { str: str, end: it.end, h: it.h };
    }
    return fixLigatures(collapse(out));
  }

  /* ================================================================== *
   * 3b. Diagram callouts (see the note by LABEL_GAP_FACTOR)
   * ================================================================== */

  /* A numbered row ("R12-R17:", "3.", "Rnd 4)") - never a caption. */
  var LABEL_ROW_RE = /^[-*•]?\s*(?:r(?:nd|ound|ow)?s?\.?\s*)?\d+\s*(?:[-–]\s*(?:r(?:nd|ound|ow)?s?\.?\s*)?\d+\s*)?[:.)]/i;
  /* A stitch total in brackets - real instructions, not a caption. */
  var LABEL_COUNT_RE = /[(\[]\s*\d+\s*(?:sts?|stitches?|sc)?\s*[)\]]/i;
  /* A heading ("Ears:") or a make-count ("(make 2)") - keep those too. */
  var LABEL_HEADING_RE = /[:)]\s*$/;

  /** The gap that one line normally leaves above the next in this column. */
  function medianPitch(rows) {
    var gaps = [], i;
    for (i = 1; i < rows.length; i++) {
      var g = rows[i - 1].y - rows[i].y;
      if (g > 0.5) gaps.push(g);
    }
    if (!gaps.length) return 0;
    gaps.sort(function (a, b) { return a - b; });
    return gaps[Math.floor(gaps.length / 2)];
  }

  /** The page's body text size: the height that carries the most characters. */
  function dominantHeight(rows) {
    var tally = {}, best = 0, bestN = 0;
    rows.forEach(function (row) {
      row.items.forEach(function (it) {
        var n = it.str.replace(/\s/g, '').length;
        if (!n) return;
        var key = Math.round(it.h * 2) / 2;
        tally[key] = (tally[key] || 0) + n;
        if (tally[key] > bestN) { bestN = tally[key]; best = key; }
      });
    });
    return best;
  }

  /** Could this one row be a caption rather than pattern text? */
  function looksLikeCaption(row, bodyH, deglyph) {
    var text = rowText(row, deglyph);
    if (!text) return true;
    if (LABEL_HEADING_RE.test(text)) return false;
    if (LABEL_ROW_RE.test(text)) return false;
    if (LABEL_COUNT_RE.test(text)) return false;
    var h = 0;
    for (var i = 0; i < row.items.length; i++) {
      if (row.items[i].h > h) h = row.items[i].h;
    }
    // A section heading stands alone between two blocks of rows exactly like
    // a caption does, and the one thing that always separates them is size:
    // a heading is set BIGGER than the body text, a caption never is.
    if (bodyH > 0 && h > bodyH * LABEL_BIG_FONT) return false;
    // fine print sitting apart from the text is a caption whatever it says
    if (bodyH > 0 && h <= bodyH * LABEL_SMALL_FONT) return true;
    return text.split(/\s+/).length <= LABEL_MAX_WORDS && text.length <= LABEL_MAX_CHARS;
  }

  /**
   * Which of one column's rows are captions drawn over artwork?
   * The column is cut into blocks wherever a gap several line-pitches deep
   * interrupts it; a small block of caption-ish lines that is not the
   * column's main body is artwork text.
   * @param {Array} rows   one column's rows, already sorted top to bottom
   * @param {number} bodyH the page's dominant text height
   * @param {boolean} [deglyph] letter-spaced page (see rowText)
   * @returns {Object} map of row index in `rows` -> true
   */
  function labelRows(rows, bodyH, deglyph) {
    var drop = {}, i, k;
    if (!rows || rows.length < MIN_ROWS_FOR_LABELS) return drop;
    var pitch = medianPitch(rows);
    if (!(pitch > 0)) return drop;

    var blocks = [], block = [0];
    for (i = 1; i < rows.length; i++) {
      if (rows[i - 1].y - rows[i].y > pitch * LABEL_GAP_FACTOR) {
        blocks.push(block);
        block = [];
      }
      block.push(i);
    }
    blocks.push(block);
    if (blocks.length < 2) return drop;

    var biggest = 0;
    for (i = 1; i < blocks.length; i++) {
      if (blocks[i].length > blocks[biggest].length) biggest = i;
    }
    for (i = 0; i < blocks.length; i++) {
      if (i === biggest) continue;                 // the column's own text
      if (blocks[i].length > LABEL_MAX_LINES) continue;
      var all = true;
      for (k = 0; k < blocks[i].length; k++) {
        if (!looksLikeCaption(rows[blocks[i][k]], bodyH, deglyph)) { all = false; break; }
      }
      if (!all) continue;
      for (k = 0; k < blocks[i].length; k++) drop[blocks[i][k]] = true;
    }
    return drop;
  }

  /* ================================================================== *
   * 4. Column detection
   * ================================================================== */

  /**
   * Find a vertical band inside [x0, x1] that (nearly) no line bridges.
   * @returns {{start:number, end:number, mid:number}|null}
   */
  function findGap(rows, x0, x1) {
    var width = x1 - x0;
    if (!(width > 0) || rows.length < MIN_LINES_FOR_COLUMNS) return null;

    var buckets = Math.ceil(width) + 1;
    if (buckets < MIN_GAP_WIDTH * 2) return null;
    var crossing = new Array(buckets);
    var b;
    for (b = 0; b < buckets; b++) crossing[b] = 0;

    var seen = new Array(buckets);
    for (var r = 0; r < rows.length; r++) {
      for (b = 0; b < buckets; b++) seen[b] = false;
      var items = rows[r].items;
      for (var i = 0; i < items.length; i++) {
        var from = Math.max(0, Math.floor(items[i].x - x0));
        var to = Math.min(buckets - 1, Math.ceil(items[i].end - x0));
        for (b = from; b <= to; b++) seen[b] = true;
      }
      for (b = 0; b < buckets; b++) if (seen[b]) crossing[b]++;
    }

    var allowed = Math.floor(rows.length * MAX_CROSSING);
    var lo = x0 + width * BAND_LO;
    var hi = x0 + width * BAND_HI;

    var best = null;
    var runStart = -1;
    for (b = 0; b <= buckets; b++) {
      var clear = b < buckets && crossing[b] <= allowed;
      if (clear) {
        if (runStart < 0) runStart = b;
        continue;
      }
      if (runStart >= 0) {
        var start = x0 + runStart;
        var end = x0 + b;
        var mid = (start + end) / 2;
        if (end - start >= MIN_GAP_WIDTH && mid >= lo && mid <= hi) {
          if (!best || end - start > best.end - best.start) {
            best = { start: start, end: end, mid: mid };
          }
        }
        runStart = -1;
      }
    }
    return best;
  }

  /**
   * Split `rows` into columns at the gap band, recursively (max 3 columns).
   * Items are assigned by their centre, so a full-width heading that overhangs
   * the band still lands in the column it started in instead of swallowing the
   * other column's text on the same baseline.
   * @returns {{columns: Array<Array<row>>, split: boolean}}
   */
  function columnize(rows, x0, x1, budget) {
    if (budget.left <= 0 || rows.length < MIN_LINES_FOR_COLUMNS) {
      return { columns: [rows], split: false };
    }
    var band = findGap(rows, x0, x1);
    if (!band) return { columns: [rows], split: false };

    var left = [];
    var right = [];
    rows.forEach(function (row) {
      var li = [];
      var ri = [];
      for (var i = 0; i < row.items.length; i++) {
        var it = row.items[i];
        if ((it.x + it.end) / 2 < band.mid) li.push(it);
        else ri.push(it);
      }
      if (li.length) left.push({ y: row.y, items: li });
      if (ri.length) right.push({ y: row.y, items: ri });
    });

    // Only a real two-column page, please: both sides need actual content.
    var share = Math.max(MIN_COLUMN_LINES, Math.ceil(rows.length * MIN_COLUMN_SHARE));
    if (left.length < share || right.length < share) {
      return { columns: [rows], split: false };
    }

    budget.left -= 1;
    var out = [];
    var sub = columnize(left, x0, band.mid, budget);
    out = out.concat(sub.columns);
    sub = columnize(right, band.mid, x1, budget);
    out = out.concat(sub.columns);
    return { columns: out, split: true };
  }

  /* ================================================================== *
   * 5. One page → lines
   * ================================================================== */

  function pageLines(items, pageWidth, pageHeight) {
    var rows = buildRows(items);
    // Judge letter spacing on the whole page, before it is cut into columns.
    var deglyph = pageLooksSpaced(rows);
    // The body text size is judged on the whole page, before it is cut up.
    var bodyH = dominantHeight(rows);
    var budget = { left: MAX_COLUMNS - 1 };
    var res = columnize(rows, 0, pageWidth, budget);
    var h = pageHeight > 0 ? pageHeight : 792;
    var lines = [];
    res.columns.forEach(function (col) {
      // Page furniture goes first: a page number alone in the corner would
      // otherwise join the caption block beside it and, being set large,
      // vouch for it as a heading.
      var kept = [];
      col.slice().sort(function (a, b) { return b.y - a.y; }).forEach(function (row) {
        var text = rowText(row, deglyph);
        if (!text || isFurniture(text)) return;
        kept.push({ row: row, text: text });
      });
      var labels = labelRows(kept.map(function (k) { return k.row; }), bodyH, deglyph);
      kept.forEach(function (k, rowIdx) {
        if (labels[rowIdx]) return;               // caption drawn over artwork
        // Baselines live in PDF space: high Y is the top of the page.
        var margin = k.row.y >= h * (1 - MARGIN_BAND) || k.row.y <= h * MARGIN_BAND;
        lines.push({ text: k.text, margin: margin });
      });
    });
    return { lines: lines, split: res.split };
  }

  /**
   * Running heads and feet ("Snor the Sleeping Bear", "© 2024 …") repeat in the
   * page margins. Left in, the parser reads them as section headers, so drop
   * any margin line that turns up on several pages.
   */
  /** "Snor the Sleeping Bear 3 of 6" and "… 4 of 6" are the same running head. */
  function marginKey(text) {
    return text
      .replace(/^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?[\s.|·•–—-]*/i, '')
      .replace(/[\s.|·•–—-]*(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function dropRunningFurniture(pages) {
    if (pages.length < 3) {
      return pages.map(function (p) {
        return p.lines.map(function (l) { return l.text; });
      });
    }
    var counts = {};
    pages.forEach(function (p) {
      var seen = {};
      p.lines.forEach(function (l) {
        if (!l.margin) return;
        var key = marginKey(l.text);
        if (!key || seen[key]) return;
        seen[key] = true;
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    var threshold = Math.max(3, Math.ceil(pages.length * 0.4));
    return pages.map(function (p) {
      var kept = [];
      p.lines.forEach(function (l) {
        if (l.margin && counts[marginKey(l.text)] >= threshold) return;
        kept.push(l.text);
      });
      return kept;
    });
  }

  /* ================================================================== *
   * 6. Public API
   * ================================================================== */

  function readArrayBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('Couldn’t open that file.')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function friendlyError(err) {
    var name = (err && err.name) || '';
    var msg = (err && err.message) || '';
    if (name === 'PasswordException' || /password/i.test(msg)) {
      return new Error('That PDF is password protected.');
    }
    if (name === 'InvalidPDFException' || /invalid pdf/i.test(msg)) {
      return new Error('That file isn’t a readable PDF.');
    }
    if (/reader/i.test(msg)) return err instanceof Error ? err : new Error(msg);
    return new Error('Couldn’t read that PDF (it may be scanned images).');
  }

  /**
   * @param {File|Blob} file
   * @param {{onProgress?: function(number, number)}} [opts]
   * @returns {Promise<{text:string, pages:number, chars:number, columnsDetected:number}>}
   */
  function extract(file, opts) {
    opts = opts || {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    if (!file) return Promise.reject(new Error('No file to read.'));

    var lib, doc;
    return loadLib()
      .then(function (l) {
        lib = l;
        return readArrayBuffer(file);
      })
      .then(function (buf) {
        return lib.getDocument({
          data: new Uint8Array(buf),
          isEvalSupported: false,
          disableFontFace: true
        }).promise;
      })
      .then(function (pdf) {
        doc = pdf;
        var total = pdf.numPages || 0;
        var pages = [];
        var columnsDetected = 0;
        var chain = Promise.resolve();

        var makeStep = function (p) {
          return function () {
            if (onProgress) {
              try { onProgress(p, total); } catch (e) { /* UI errors are not our problem */ }
            }
            return doc.getPage(p).then(function (page) {
              return page.getTextContent().then(function (tc) {
                var width = 612;
                var height = 792;
                try {
                  var vp = page.getViewport({ scale: 1 });
                  if (vp && vp.width) width = vp.width;
                  if (vp && vp.height) height = vp.height;
                } catch (e) { /* fall back to US Letter */ }
                var res = pageLines(tc.items || [], width, height);
                if (res.split) columnsDetected++;
                pages.push({ number: p, lines: res.lines });
                if (typeof page.cleanup === 'function') page.cleanup();
              });
            });
          };
        };

        for (var p = 1; p <= total; p++) chain = chain.then(makeStep(p));

        return chain.then(function () {
          var cleaned = dropRunningFurniture(pages);
          var blocks = cleaned.map(function (lines, i) {
            return '=== PAGE ' + pages[i].number + ' ===\n' + lines.join('\n');
          });
          var text = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
          var body = text.replace(/^=== PAGE \d+ ===$/gm, '').replace(/\s/g, '');
          if (!body.length) {
            throw new Error('Couldn’t read that PDF (it may be scanned images).');
          }
          return {
            text: text,
            pages: total,
            chars: text.length,
            columnsDetected: columnsDetected
          };
        });
      })
      .then(
        function (result) {
          if (doc && typeof doc.destroy === 'function') { try { doc.destroy(); } catch (e) {} }
          return result;
        },
        function (err) {
          if (doc && typeof doc.destroy === 'function') { try { doc.destroy(); } catch (e) {} }
          throw friendlyError(err);
        }
      );
  }

  /* ================================================================== *
   * 7. Open a document and keep it around
   *
   * `extract` loads, reads and throws the document away. A craft that also
   * wants to rasterise chart pages needs the document to stay open, so:
   *
   *   PdfText.open(file) -> Promise<{
   *     doc,                       // the pdf.js PDFDocumentProxy
   *     numPages,
   *     textOf(pageNo)             -> Promise<string>            (same line
   *                                   grouping, column splitting and furniture
   *                                   dropping as extract, for one page)
   *     renderPage(pageNo, { scale | maxWidth }) -> Promise<HTMLCanvasElement>
   *     destroy()                  // release it when the sheet closes
   *   }>
   * ================================================================== */

  function pageSize(page) {
    var size = { width: 612, height: 792 };
    try {
      var vp = page.getViewport({ scale: 1 });
      if (vp && vp.width) size.width = vp.width;
      if (vp && vp.height) size.height = vp.height;
    } catch (e) {
      /* fall back to US Letter */
    }
    return size;
  }

  /**
   * @param {File|Blob} file
   * @returns {Promise<Object>}
   */
  function open(file) {
    if (!file) return Promise.reject(new Error('No file to read.'));
    var lib;
    return loadLib()
      .then(function (l) {
        lib = l;
        return readArrayBuffer(file);
      })
      .then(function (buf) {
        return lib.getDocument({
          data: new Uint8Array(buf),
          isEvalSupported: false,
          disableFontFace: true
        }).promise;
      })
      .then(
        function (doc) {
          var destroyed = false;

          function textOf(pageNo) {
            var n = parseInt(pageNo, 10);
            if (!isFinite(n) || n < 1 || n > (doc.numPages || 0)) {
              return Promise.resolve('');
            }
            return doc.getPage(n).then(function (page) {
              return page.getTextContent().then(function (tc) {
                var size = pageSize(page);
                var res = pageLines(tc.items || [], size.width, size.height);
                if (typeof page.cleanup === 'function') page.cleanup();
                return res.lines
                  .map(function (l) { return l.text; })
                  .join('\n');
              });
            });
          }

          function renderPage(pageNo, opts) {
            opts = opts || {};
            var n = parseInt(pageNo, 10);
            if (!isFinite(n) || n < 1 || n > (doc.numPages || 0)) {
              return Promise.reject(new Error('No page ' + pageNo + ' in that PDF.'));
            }
            return doc.getPage(n).then(function (page) {
              var base = pageSize(page);
              var scale = 1;
              if (typeof opts.scale === 'number' && opts.scale > 0) {
                scale = opts.scale;
              } else if (typeof opts.maxWidth === 'number' && opts.maxWidth > 0 && base.width > 0) {
                scale = opts.maxWidth / base.width;
              }
              var vp = page.getViewport({ scale: scale });
              var canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(vp.width));
              canvas.height = Math.max(1, Math.round(vp.height));
              var ctx2d = canvas.getContext('2d');
              if (!ctx2d) return Promise.reject(new Error('This device cannot draw the page.'));
              var task = page.render({ canvasContext: ctx2d, viewport: vp });
              var done = task && task.promise ? task.promise : Promise.resolve();
              return done.then(function () {
                if (typeof page.cleanup === 'function') page.cleanup();
                return canvas;
              });
            });
          }

          return {
            doc: doc,
            numPages: doc.numPages || 0,
            textOf: textOf,
            renderPage: renderPage,
            destroy: function () {
              if (destroyed) return;
              destroyed = true;
              if (doc && typeof doc.destroy === 'function') {
                try { doc.destroy(); } catch (e) { /* ignore */ }
              }
            }
          };
        },
        function (err) {
          throw friendlyError(err);
        }
      );
  }

  window.PdfText = {
    extract: extract,
    open: open,
    isAvailable: isAvailable,
    /** Exposed for the dev fixtures page / tests. */
    _pageLines: pageLines,
    _fixLigatures: fixLigatures,
    _buildRows: buildRows,
    _rowText: rowText,
    _pageLooksSpaced: pageLooksSpaced,
    _dropRotated: dropRotated,
    _dominantHeight: dominantHeight,
    _medianPitch: medianPitch,
    _labelRows: labelRows
  };
})();
