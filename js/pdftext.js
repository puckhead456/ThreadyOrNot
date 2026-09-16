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
   * Group a page's text items into rows by their baseline Y.
   * @returns {Array<{y:number, items:Array<{x:number,end:number,h:number,str:string}>}>}
   */
  function buildRows(items) {
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

  /** Join one row's items into a single line of text. */
  function rowText(row) {
    var out = '';
    var prev = null;
    for (var i = 0; i < row.items.length; i++) {
      var it = row.items[i];
      var lig = LIGATURES.test(it.str.trim());
      if (prev) {
        var glued =
          lig ||                                    // ligature glyph: part of a word
          LIGATURES.test(prev.str.trim()) ||
          /\s$/.test(prev.str) ||                   // the space is already in the text
          /^\s/.test(it.str) ||
          it.x - prev.end < 0.15 * Math.max(prev.h, it.h);  // glyphs are touching
        if (!glued) out += ' ';
      }
      out += it.str;
      prev = it;
    }
    return fixLigatures(collapse(out));
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
    var budget = { left: MAX_COLUMNS - 1 };
    var res = columnize(rows, 0, pageWidth, budget);
    var h = pageHeight > 0 ? pageHeight : 792;
    var lines = [];
    res.columns.forEach(function (col) {
      col.slice().sort(function (a, b) { return b.y - a.y; }).forEach(function (row) {
        var text = rowText(row);
        if (!text) return;
        if (isFurniture(text)) return;
        // Baselines live in PDF space: high Y is the top of the page.
        var margin = row.y >= h * (1 - MARGIN_BAND) || row.y <= h * MARGIN_BAND;
        lines.push({ text: text, margin: margin });
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
    _fixLigatures: fixLigatures
  };
})();
