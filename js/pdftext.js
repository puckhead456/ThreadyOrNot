/* Thready or Not — js/pdftext.js
 * window.PdfText : pull plain text out of a pattern PDF, on-device.
 *
 * Uses the vendored pdf.js 3.11.174 UMD build, loaded lazily on first use so
 * the 300KB library never costs anything to people who only paste text. Both
 * the library and its worker are precached by the service worker, so once the
 * app has been installed this works with no network at all.
 *
 *   PdfText.extract(file, { onProgress(page, total), maxPages, signal })
 *     → Promise<{ text, pages, pagesTotal, chars, columnsDetected, emptyPages,
 *                 garbled }>
 *
 *     garbled     true when the text came back unreadable because the PDF
 *                 embeds a subset font with no ToUnicode map (06 #5). The
 *                 character count looks healthy, so nothing else gives it
 *                 away; the UI should say "we could read the pages but not
 *                 the letters" rather than showing the mojibake. Additive:
 *                 every existing caller ignores it safely.
 *
 *     emptyPages  1-based page numbers that carried fewer than ~20
 *                 non-whitespace characters once the page furniture was
 *                 dropped: an image cover, a photo-tutorial page, a blank.
 *                 Mixed PDFs (a designed cover, real text, photo pages) are
 *                 extremely common and until now "Read 24 pages · 1,240
 *                 characters" gave no hint that the Legs live in a picture.
 *                 The UI wording must be "no readable text", never "failed".
 *     pages       pages actually read; pagesTotal is what the document holds.
 *     maxPages    stop after this many pages (the big-file guard).
 *     signal      { cancelled:boolean } or an AbortSignal. Checked at the head
 *                 of every page step; on cancel the document is destroyed and
 *                 the promise rejects with an Error whose .name is
 *                 'AbortError'. The caller must leave the textarea untouched.
 *
 *   PdfText.SIZE_WARN_BYTES - files bigger than this deserve a confirm sheet
 *     ("That's a 61 MB file... read the first 20 pages?") before extract runs.
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
  // How wide the clear band has to be. Yarnspirations four-column landscape
  // pages (crochet-caron-cuff-cardigan) set a 12 pt gutter between 10 pt
  // text, so the old 14 threw two of the three gutters away and merged four
  // columns into two.
  var MIN_GAP_WIDTH = 10;
  // ...unless lines DO bridge it, in which case it has to be a proper gutter:
  // the band that split a Pattern Runway size chart after its third size was
  // 13 pt wide and bridged by a fifth of the page (sew-sundress).
  var MIN_GAP_WIDTH_NOISY = 14;
  var BAND_LO = 0.30;               // ...and sit between 30%
  var BAND_HI = 0.70;               // ...and 70% of the region width
  // How many lines may bridge the band. This is the number that tells a
  // GUTTER from the space between two cells of a table, and the two are far
  // apart once you measure them: the 12 pt gutter of a Yarnspirations
  // landscape page is bridged by 3% of its lines and Lion Brand's narrow
  // sidebar by 4-9%, while the band between the third and fourth size of a
  // Pattern Runway size chart is bridged by 21% (the prose above it). At the
  // old 30% the chart split and lost two sizes (sew-sundress).
  var MAX_CROSSING = 0.30;          // ...at the very most
  var CLEAN_CROSSING = 0.12;        // a band bridged less than this is clean
  // A band that is NOT clean may still be a gutter, but only if what it cuts
  // off is a column and not a cell: both sides have to be a quarter of the
  // region wide.
  var NOISY_COLUMN_SHARE = 0.25;
  var MIN_COLUMN_LINES = 3;         // both sides must hold real content
  var MIN_COLUMN_SHARE = 0.15;
  // A TABLE is not a set of columns. A size chart ("Size Chart (cm) 36 38 40
  // 42 44" over "Bust 84 88 92 96 100") leaves a clear band between every
  // pair of cells, and splitting there cuts the chart up and loses the last
  // two sizes (sew-sundress). What tells a table from a page of columns is
  // not any one gutter but the COMB: three or more clear bands inside the
  // region with narrow cells between them. Two columns of prose, even four of
  // them on a Yarnspirations landscape page, leave cells an inch wide or
  // more, so the comb test never fires on those.
  var TABLE_MIN_GUTTERS = 3;
  var TABLE_CELL_WIDTH = 110;     // a cell is narrower than this
  var TABLE_MAX_GUTTER = 40;      // ...a cell wall is never wider than this
  var TABLE_EVENNESS = 0.40;      // ...and the cells are all about the same width
  var MIN_COLUMN_WIDTH = 24;      // and nothing thinner than this is a column
  var MAX_COLUMNS = 4;            // Yarnspirations reference pages stack four
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
    /^\d{1,4}\s*(?:of|\/)\s*\d{1,4}$/i,           // 3 of 6
    /^page\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i,
    /^[-–—•|]+\s*\d{1,4}\s*[-–—•|]+$/,            // - 4 -
    /^[A-Z](?:\s+[A-Z])*$/,                       // photo labels: A / E F / I J K
    /all\s+rights\s+reserved/i,
    /^[©@(]?\s*(?:c|©)?\s*(?:copyright)?\s*\(?\s*[©c]?\s*\)?\s*(?:19|20)\d{2}\b/i
  ];

  /* A bare number is a page number only in the MARGIN. In the middle of the
   * page it is a cell of a table: a floss code, a stitch count, a size. A
   * colour key's code column, emitted as a column of its own, is a stack of
   * bare numbers, and treating them as page numbers cost xs-dmc-2168 four of
   * its fifteen colours. */
  var BARE_NUMBER_RE = /^\d{1,4}$/;

  function isFurniture(line) {
    if (!line) return true;
    if (line.indexOf('©') >= 0) return true;
    if (isPageWord(line)) return true;
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
   * Is this page SET sideways, as opposed to holding a sideways block?
   * Both halves are needed. A Peppermint size chart is a landscape table
   * typeset at 90 degrees on an upright sheet (page.rotate 0), and reading
   * the whole page along its long edge chops the chart up; a Tiny Modernist
   * chart page really is /Rotate 90, and reading it upright runs every
   * column of its colour key together ("DMCEcru38553854").
   */
  function pageIsSideways(items, rotate) {
    if (rotate !== 90 && rotate !== 270) return false;
    var rot = 0, all = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string') continue;
      var n = it.str.replace(/\s/g, '').length;
      if (!n) continue;
      all += n;
      if (isRotated(it)) rot += n;
    }
    return all > 0 && rot > all * 0.5;
  }

  /**
   * Group a page's text items into rows by their baseline.
   *
   * On an ordinary page the baseline is a Y and the text advances along X, so
   * rows are keyed on transform[5] and ordered on transform[4]. On a page the
   * generator set sideways (/Rotate 90: every text matrix is [0,h,-h,0,x,y])
   * that is exactly backwards - the line runs along Y and the lines stack
   * along X - and keying on Y turned each printed COLUMN into a row, with no
   * spaces between the pieces ("DMCEcru3855385438473848" out of
   * xs-tinymodernist-homestitchhome). So the axes swap, and the direction of
   * each axis comes from the matrix: the text advances along (a, b) and the
   * next line sits opposite the glyph's up vector (c, d).
   *
   * Every row carries `order` (increasing = further down the page in reading
   * order) so callers never have to know which axis was used; `y` is the row
   * key in PDF units, which is what the margin test measures.
   *
   * @returns {Array<{y:number, order:number,
   *                  items:Array<{x:number,end:number,h:number,str:string}>}>}
   *   plus `.sideways` and `.span` ({lo, hi} of the in-row axis) on the array.
   */
  function buildRows(items, rotate) {
    items = dropRotated(items || []);
    var sideways = pageIsSideways(items, rotate);
    var rows = [];
    var lo = Infinity, hi = -Infinity, keyLo = Infinity, keyHi = -Infinity;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string' || !it.str.length) continue;
      if (!it.transform || it.transform.length < 6) continue;
      var t = it.transform;
      var w = typeof it.width === 'number' && isFinite(it.width) ? it.width : 0;
      var h = typeof it.height === 'number' && isFinite(it.height) && it.height > 0
        ? it.height
        : Math.abs(sideways ? t[1] : t[3]) || 10;
      var key, pos, adv, lineDir;
      if (sideways) {
        key = t[4];                              // the line's position across the sheet
        pos = t[5];                              // ...and how far along the line
        adv = t[1] >= 0 ? 1 : -1;                // the text advances this way in Y
        lineDir = t[2] <= 0 ? 1 : -1;            // the next line sits this way in X
      } else {
        key = t[5];
        pos = t[4];
        adv = 1;
        lineDir = -1;                            // high Y is the top of the page
      }
      var x = adv * pos;
      if (x < lo) lo = x;
      if (x + w > hi) hi = x + w;
      if (key < keyLo) keyLo = key;
      if (key > keyHi) keyHi = key;
      var row = null;
      for (var r = rows.length - 1; r >= 0; r--) {
        if (Math.abs(rows[r].y - key) <= Y_TOLERANCE) { row = rows[r]; break; }
      }
      if (!row) {
        row = { y: key, order: lineDir * key, items: [] };
        rows.push(row);
      }
      row.items.push({ x: x, end: x + w, h: h, str: it.str });
    }
    // A total order, so two runs over the same page can never disagree: ties
    // on the baseline are broken on the first item's position.
    rows.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return (a.items[0] ? a.items[0].x : 0) - (b.items[0] ? b.items[0].x : 0);
    });
    rows.forEach(function (row) {
      row.items.sort(function (a, b) {
        if (a.x !== b.x) return a.x - b.x;
        return a.end - b.end;
      });
    });
    var out = rows.filter(function (row) { return row.items.length > 0; });
    out.sideways = sideways;
    out.span = { lo: isFinite(lo) ? lo : 0, hi: isFinite(hi) ? hi : 0 };
    out.keySpan = { lo: isFinite(keyLo) ? keyLo : 0, hi: isFinite(keyHi) ? keyHi : 0 };
    return out;
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
  /* A display heading set with extra tracking arrives as a run of items with
   * a uniform gap between them, and a fixed 0.15 em glue threshold turns
   * "CUTTING LAYOUTS" into "CUT TING L AYOUTS" (sew-peppermint-samford-pants).
   * The gap that means "new word" is not a constant, it is relative to the
   * gaps THIS line uses: on a tracked line the word space is several times
   * the tracking. So the threshold is the line's own median gap with room to
   * spare, capped below a real word space so ordinary prose is untouched. */
  var GLUE_BASE = 0.15;      // em - always glue a gap this small
  var GLUE_FACTOR = 1.6;     // ...or this much more than the line's own median
  var GLUE_MAX = 0.45;       // ...but never a gap this big: that is a space
  var GLUE_MIN_GAPS = 4;     // a line needs this many gaps to have a median
  var GLUE_TRACKED = 0.25;   // em - a median gap under this is tracking, not spaces

  function rowGlueGap(row) {
    var gaps = [];
    for (var i = 1; i < row.items.length; i++) {
      var g = row.items[i].x - row.items[i - 1].end;
      var h = Math.max(row.items[i].h, row.items[i - 1].h) || 10;
      if (g > 0 && !/\s$/.test(row.items[i - 1].str) && !/^\s/.test(row.items[i].str)) {
        gaps.push(g / h);
      }
    }
    if (gaps.length < GLUE_MIN_GAPS) return GLUE_BASE;
    gaps.sort(function (a, b) { return a - b; });
    var median = gaps[Math.floor(gaps.length / 2)];
    // Only when the line's TYPICAL gap is smaller than a word space. A line
    // whose items are whole words with no space characters between them has a
    // median gap that IS a word space, and raising the threshold there would
    // run every word on the line together.
    if (!(median > 0) || median >= GLUE_TRACKED) return GLUE_BASE;
    return Math.max(GLUE_BASE, Math.min(median * GLUE_FACTOR, GLUE_MAX));
  }

  function rowText(row, deglyph) {
    var out = '';
    var prev = null;
    var glue = rowGlueGap(row);
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
          it.x - prev.end < glue * Math.max(prev.h, it.h);  // glyphs are touching
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
  /* One bare code on a line of its own: a floss number, a shade number. */
  var LABEL_CODE_RE = /^[A-Za-z]?\d{2,5}$/;

  /** The gap that one line normally leaves above the next in this column. */
  function medianPitch(rows) {
    var gaps = [], i;
    for (i = 1; i < rows.length; i++) {
      var g = rows[i].order - rows[i - 1].order;
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
    // A line that is one bare code ("946", "B5200") is a cell of a key, not a
    // caption: a caption is words. Page numbers, which look the same, are
    // already gone by here (isFurniture). Without this, a colour key's third
    // legend column - four short numeric lines in a narrow column - was
    // thrown away as artwork text and xs-dmc-2168 lost DMC 946/947/967/970.
    if (LABEL_CODE_RE.test(text)) return false;
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
      if (rows[i].order - rows[i - 1].order > pitch * LABEL_GAP_FACTOR) {
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
   * Maximal runs of buckets whose crossing count is at or under `level`.
   * @returns {Array<{start:number,end:number,mid:number}>}
   */
  function clearRuns(crossing, x0, level) {
    var out = [];
    var runStart = -1;
    for (var b = 0; b <= crossing.length; b++) {
      if (b < crossing.length && crossing[b] <= level) {
        if (runStart < 0) runStart = b;
        continue;
      }
      if (runStart >= 0) {
        out.push({ start: x0 + runStart, end: x0 + b, mid: x0 + (runStart + b) / 2 });
        runStart = -1;
      }
    }
    return out;
  }

  /**
   * A comb of narrow cells: the region is a TABLE, and none of its gutters is
   * a column break. Only bands strictly inside the region count - the white
   * margins at the two edges are not cell walls.
   */
  function looksLikeTable(runs, x0, x1) {
    var inner = [];
    for (var i = 0; i < runs.length; i++) {
      // Only bands that are the right SIZE for a cell wall: the wide clear
      // band beside a single column of text is not one.
      var w = runs[i].end - runs[i].start;
      if (runs[i].start > x0 + 1 && runs[i].end < x1 - 1 && w <= TABLE_MAX_GUTTER) {
        inner.push(runs[i]);
      }
    }
    if (inner.length < TABLE_MIN_GUTTERS) return false;
    inner.sort(function (a, b) { return a.start - b.start; });
    var cells = [];
    for (i = 1; i < inner.length; i++) cells.push(inner[i].start - inner[i - 1].end);
    if (!cells.length) return false;
    var total = 0;
    for (i = 0; i < cells.length; i++) total += cells[i];
    var mean = total / cells.length;
    if (!(mean > 0) || mean >= TABLE_CELL_WIDTH) return false;
    // ...and EVENLY spaced. Three clear bands at three unrelated distances
    // are three different things on the page, not the walls of one table.
    var varsum = 0;
    for (i = 0; i < cells.length; i++) varsum += (cells[i] - mean) * (cells[i] - mean);
    return Math.sqrt(varsum / cells.length) / mean <= TABLE_EVENNESS;
  }

  /**
   * Candidate split x positions inside [x0, x1], best first.
   *
   * A gutter is a vertical band no line bridges, but "no line" has to survive
   * three real layouts, so the candidates are gathered at three strictnesses
   * and tried in order (the caller checks that both sides hold content, and
   * moves on to the next candidate when they do not):
   *
   *  A. the widest band at most MAX_CROSSING of the lines bridge, centred in
   *     the page's middle third. This is the original rule and it is tried
   *     first so pages that already split keep splitting exactly as before.
   *  B. the widest band NO line bridges at all. Yarnspirations one-pagers
   *     (crochet-bernat-basketweave) put a sparse materials/abbreviations
   *     stack beside a dense instruction column: over half the page reads as
   *     "clear" under rule A, so the widest such band is the empty left half
   *     and its midpoint lands outside the middle third. The true 16 pt
   *     gutter is bridged by nothing at all and rule B finds it.
   *  C. the widest band from rule A that merely OVERLAPS the middle third,
   *     split where it enters it. Red Heart one-pagers
   *     (crochet-redheart-persian-tiles) have the same sparse-beside-dense
   *     shape, but a running head and a footer do bridge the gutter, so no
   *     band is perfectly clear and rule B finds nothing either.
   *
   * @returns {number[]} split positions, best first
   */
  function findGaps(rows, x0, x1) {
    var width = x1 - x0;
    if (!(width > 0) || rows.length < MIN_LINES_FOR_COLUMNS) return [];

    var buckets = Math.ceil(width) + 1;
    if (buckets < MIN_GAP_WIDTH * 2) return [];
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
    var wide = function (run) { return run.end - run.start >= MIN_GAP_WIDTH; };
    var wideNoisy = function (run) { return run.end - run.start >= MIN_GAP_WIDTH_NOISY; };
    // A total order, so two runs over the same page can never disagree.
    var widest = function (a, c) {
      var d = (c.end - c.start) - (a.end - a.start);
      return d !== 0 ? d : a.start - c.start;
    };

    var clean = Math.floor(rows.length * CLEAN_CROSSING);
    var loose = clearRuns(crossing, x0, allowed).filter(wideNoisy);
    var strict = clearRuns(crossing, x0, clean).filter(wide);
    if (looksLikeTable(loose, x0, x1)) return [];

    var out = [];
    var push = function (x, noisy) {
      for (var i = 0; i < out.length; i++) if (Math.abs(out[i].x - x) < 1) return;
      out.push({ x: x, noisy: !!noisy });
    };

    // A - a band (almost) nothing bridges, centred in the middle third. This
    //     is the one that fits a page of columns, and it is tried first.
    strict.slice().sort(widest).forEach(function (run) {
      if (run.mid >= lo && run.mid <= hi) push(run.mid, false);
    });
    // B - the same, allowing up to MAX_CROSSING of the lines to bridge it.
    //     Flagged NOISY: the caller only takes it when both sides are wide
    //     enough to be columns, because the other thing that leaves a band
    //     most-but-not-all lines respect is a table (sew-sundress).
    loose.slice().sort(widest).forEach(function (run) {
      if (run.mid >= lo && run.mid <= hi) push(run.mid, true);
    });
    // C - a band that only reaches INTO the middle third, split where it
    //     enters. Red Heart and Bernat one-pagers put a sparse materials
    //     stack beside a dense instruction column, so the clear band is the
    //     whole empty half of the page and its midpoint falls outside.
    loose.slice().sort(widest).forEach(function (run) {
      if (run.end <= lo || run.start >= hi) return;
      if (Math.min(run.end, hi) - Math.max(run.start, lo) < MIN_GAP_WIDTH) return;
      push(Math.min(Math.max(run.mid, lo), hi), true);
    });
    return out;
  }

  /**
   * Split `rows` into columns at the gap band, recursively (max 3 columns).
   * Items are assigned by their centre, so a full-width heading that overhangs
   * the band still lands in the column it started in instead of swallowing the
   * other column's text on the same baseline.
   * @returns {{columns: Array<Array<row>>, split: boolean}}
   */
  /** How wide the content of one side of a candidate split actually is. */
  function extentOf(rows) {
    var lo = Infinity, hi = -Infinity;
    for (var r = 0; r < rows.length; r++) {
      for (var i = 0; i < rows[r].items.length; i++) {
        var it = rows[r].items[i];
        if (it.x < lo) lo = it.x;
        if (it.end > hi) hi = it.end;
      }
    }
    return (isFinite(lo) && isFinite(hi)) ? hi - lo : 0;
  }

  function columnize(rows, x0, x1, budget) {
    if (budget.left <= 0 || rows.length < MIN_LINES_FOR_COLUMNS) {
      return { columns: [rows], split: false };
    }
    var gaps = findGaps(rows, x0, x1);
    // Only a real two-column page, please: both sides need actual content.
    var share = Math.max(MIN_COLUMN_LINES, Math.ceil(rows.length * MIN_COLUMN_SHARE));

    for (var g = 0; g < gaps.length; g++) {
      var mid = gaps[g].x;
      var noisy = gaps[g].noisy;
      var left = [];
      var right = [];
      rows.forEach(function (row) {
        var li = [];
        var ri = [];
        for (var i = 0; i < row.items.length; i++) {
          var it = row.items[i];
          if ((it.x + it.end) / 2 < mid) li.push(it);
          else ri.push(it);
        }
        if (li.length) left.push({ y: row.y, order: row.order, items: li });
        if (ri.length) right.push({ y: row.y, order: row.order, items: ri });
      });
      if (left.length < share || right.length < share) continue;
      var wLeft = extentOf(left), wRight = extentOf(right);
      if (wLeft < MIN_COLUMN_WIDTH || wRight < MIN_COLUMN_WIDTH) continue;
      if (noisy && (x1 - x0) > 0 &&
          (wLeft < (x1 - x0) * NOISY_COLUMN_SHARE || wRight < (x1 - x0) * NOISY_COLUMN_SHARE)) {
        continue;                  // a table's cell wall, not a gutter
      }

      budget.left -= 1;
      var out = [];
      var sub = columnize(left, x0, mid, budget);
      out = out.concat(sub.columns);
      sub = columnize(right, mid, x1, budget);
      out = out.concat(sub.columns);
      return { columns: out, split: true };
    }
    return { columns: [rows], split: false };
  }

  /* ================================================================== *
   * 5. One page → lines
   * ================================================================== */

  function pageLines(items, pageWidth, pageHeight, rotate) {
    var rows = buildRows(items, rotate);
    // Judge letter spacing on the whole page, before it is cut into columns.
    var deglyph = pageLooksSpaced(rows);
    // The body text size is judged on the whole page, before it is cut up.
    var bodyH = dominantHeight(rows);

    var budget = { left: MAX_COLUMNS - 1 };
    var sideways = !!rows.sideways;
    var span = sideways ? rows.span : { lo: 0, hi: pageWidth > 0 ? pageWidth : 612 };
    var res = columnize(rows, span.lo, span.hi, budget);
    // On a page set sideways the margins are the LEFT and RIGHT edges of the
    // sheet, which is what the row key measures there.
    // On a page set sideways the margins are the two edges the row key runs
    // between, and pdf.js has already swapped the viewport, so measure them
    // off the rows rather than guessing which of width/height to use.
    var keyLo = 0;
    var h = pageHeight > 0 ? pageHeight : 792;
    if (sideways) {
      keyLo = rows.keySpan.lo;
      h = rows.keySpan.hi - rows.keySpan.lo;
      if (!(h > 0)) h = pageWidth > 0 ? pageWidth : 612;
    }
    var lines = [];
    res.columns.forEach(function (col) {
      // Page furniture goes first: a page number alone in the corner would
      // otherwise join the caption block beside it and, being set large,
      // vouch for it as a heading.
      var kept = [];
      col.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (row) {
        var text = rowText(row, deglyph);
        if (!text || isFurniture(text)) return;
        var at0 = row.y - keyLo;
        var inMargin = at0 >= h * (1 - MARGIN_BAND) || at0 <= h * MARGIN_BAND;
        if (inMargin && BARE_NUMBER_RE.test(text)) return;     // a page number
        kept.push({ row: row, text: text });
      });
      var labels = labelRows(kept.map(function (k) { return k.row; }), bodyH, deglyph);
      kept.forEach(function (k, rowIdx) {
        if (labels[rowIdx]) return;               // caption drawn over artwork
        // Baselines live in PDF space: high Y is the top of the page.
        var at = k.row.y - keyLo;
        var margin = at >= h * (1 - MARGIN_BAND) || at <= h * MARGIN_BAND;
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

  /* A margin line that ENDS in "3 of 6" is a page stamp whatever else is glued
   * to it. Yarnspirations and Red Heart print the running head, the product
   * code, the date and the page count as one line, and glue them differently
   * on different pages ("CAC0129-026985M | July 5, 2019" stands alone on page 2
   * and joins the head on page 3), so exact-key counting misses half of them
   * and the survivors read as section headers. */
  var PAGE_STAMP_TAIL_RE = /\b(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})\s*$/i;
  // A line that SAYS "Page 8 of 9" is a page stamp wherever it is printed, not
  // only in the margin band - a chart generator puts it beside the colour key
  // and the symbol column in front of it ("110 Page 8 of 9"), where it reads
  // as one more floss code (xs-metalgreymon grew two phantom colours).
  var PAGE_WORD_RE = /^(?:\S{1,6}\s+)?page\s+(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})\s*$/i;

  function isPageStamp(text) {
    var m = PAGE_STAMP_TAIL_RE.exec(text);
    if (!m) return false;
    var n = parseInt(m[1], 10), total = parseInt(m[2], 10);
    return n >= 1 && total >= n;
  }

  function isPageWord(text) {
    var m = PAGE_WORD_RE.exec(String(text || '').trim());
    if (!m) return false;
    return parseInt(m[1], 10) >= 1 && parseInt(m[2], 10) >= parseInt(m[1], 10);
  }

  /** Keys that repeat in the margins of `threshold` pages or more. */
  function repeatedKeys(counts, threshold) {
    var out = [];
    for (var k in counts) {
      if (counts[k] >= threshold && k.length >= 8) out.push(k);
    }
    // longest first: the fullest running head wins the containment test
    out.sort(function (a, b) { return b.length - a.length; });
    return out;
  }

  /** The share of `text` taken up by a running head printed inside it. */
  var HEAD_SHARE = 0.4;

  function dropRunningFurniture(pages) {
    if (pages.length < 3) {
      return pages.map(function (p) {
        var kept = [];
        p.lines.forEach(function (l) {
          if (l.margin && isPageStamp(l.text)) return;
          kept.push(l.text);
        });
        return kept;
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
    var heads = repeatedKeys(counts, threshold);
    return pages.map(function (p) {
      var kept = [];
      p.lines.forEach(function (l) {
        if (l.margin) {
          if (counts[marginKey(l.text)] >= threshold) return;
          if (isPageStamp(l.text)) return;
          // A running head with a code or an address glued on to it.
          var key = marginKey(l.text);
          var swallowed = false;
          for (var i = 0; i < heads.length; i++) {
            if (key.indexOf(heads[i]) >= 0 && heads[i].length >= key.length * HEAD_SHARE) {
              swallowed = true;
              break;
            }
          }
          if (swallowed) return;
        }
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

  /* ---- size guard, cancellation and page cap (06 #6) ---------------- */

  /** Over this, the UI should offer a page range instead of the whole file. */
  var SIZE_WARN_BYTES = 25 * 1024 * 1024;

  /** A page with less than this much real text carried no readable text. */
  var MIN_PAGE_CHARS = 20;

  /** `signal` is either { cancelled:boolean } of ours or a real AbortSignal. */
  function isCancelled(signal) {
    return !!(signal && (signal.cancelled || signal.aborted));
  }

  function abortError() {
    var e = new Error('Import cancelled.');
    e.name = 'AbortError';
    return e;
  }

  /**
   * Page numbers whose text is under MIN_PAGE_CHARS. Exposed for tests.
   * @param {Array<Array<string>>} cleaned one array of lines per page
   * @param {number[]} [numbers] the pages' own 1-based numbers
   */
  function emptyPageNumbers(cleaned, numbers) {
    var out = [];
    for (var i = 0; i < cleaned.length; i++) {
      var n = (cleaned[i] || []).join('').replace(/\s/g, '').length;
      if (n < MIN_PAGE_CHARS) out.push(numbers && numbers[i] !== undefined ? numbers[i] : i + 1);
    }
    return out;
  }

  /* ---- Unicode hygiene (06 #7) -------------------------------------- *
   * Justified typesetting, Canva exports and anything that has been through
   * a word processor carry soft hyphens, zero-width joiners, fullwidth
   * digits, exotic bullets and curly quotes. Each one silently costs the
   * parser a whole round, so fold them to ASCII on the way out of extract().
   * (open()/textOf() is deliberately left alone: the craft modules match
   * chart glyphs against it byte for byte.) */
  /* C0 control codes are in here too (everything but tab, newline and return).
   * A subset font with a partial ToUnicode map hands back a raw glyph id for
   * the glyphs it does not describe, and those ids are usually small: the word
   * "backstitch" arrived as "backs\u001ftch" because the "ti" ligature had no
   * mapping. Left in, the control byte is a character like any other and the
   * word never matches anything; dropped, the line around it survives. The
   * garbled flag is measured on the RAW text, before this runs. */
  var INVISIBLE_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u200b-\u200d\u2060\ufeff]/g;
  var NBSP_RE = /[   ]/g;
  var BULLET_RE = /[•‣◦▪▫●○◾·‧⁃∙]/g;
  var FULLWIDTH_RE = /[！-～]/g;
  var SQUOTE_RE = /[‘’‚‛′]/g;
  var DQUOTE_RE = /[“”„‟″]/g;

  function normUnicode(s) {
    return String(s == null ? '' : s)
      .replace(INVISIBLE_RE, '')
      .replace(FULLWIDTH_RE, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
      })
      .replace(NBSP_RE, ' ')
      .replace(BULLET_RE, '-')
      .replace(SQUOTE_RE, '\'')
      .replace(DQUOTE_RE, '"');
  }

  /* ---- garbled text from a subset font with no ToUnicode map (06 #5) ---- *
   * A PDF may embed only the glyphs it uses and, without a ToUnicode map,
   * pdf.js can only hand back the raw glyph codes. The result LOOKS like text
   * to every other rule in this file - it has lines, columns and a character
   * count - but a person cannot read a word of it, and the importer would
   * happily report "read 2 pages, 714 characters" and then show nothing.
   * crochet-gosyo-motif-doily is that file: its whole body arrives as C0
   * control codes.
   * Two signals, either of which is enough:
   *   a) control codes, private-use glyphs or U+FFFD make up a real share of
   *      the non-whitespace characters;
   *   b) the latin letter runs have (almost) no vowels - the other common
   *      outcome, where glyph ids land inside the ASCII range. */
  var SUSPECT_CHAR_RE = /[---�]/g;
  var LETTER_RUN_RE = /[A-Za-z]{3,}/g;
  var VOWEL_RE = /[aeiouy]/i;
  var GARBLE_SAMPLE = 200000;     // enough of the raw text to judge by
  var GARBLE_CHAR_SHARE = 0.08;   // 8% unprintable is already unreadable
  var GARBLE_RUN_SHARE = 0.6;
  var GARBLE_MIN_RUNS = 20;

  /**
   * @param {string} text
   * @returns {{garbled:boolean, charShare:number, runShare:number, runs:number}}
   */
  function garbleScore(text) {
    var s = String(text == null ? '' : text);
    var ink = s.replace(/\s/g, '').length;
    var bad = (s.match(SUSPECT_CHAR_RE) || []).length;
    var charShare = ink ? bad / ink : 0;
    var runs = s.match(LETTER_RUN_RE) || [];
    var voiceless = 0;
    for (var i = 0; i < runs.length; i++) if (!VOWEL_RE.test(runs[i])) voiceless++;
    var runShare = runs.length ? voiceless / runs.length : 0;
    var garbled = charShare >= GARBLE_CHAR_SHARE ||
      (runs.length >= GARBLE_MIN_RUNS && runShare >= GARBLE_RUN_SHARE);
    return { garbled: garbled, charShare: charShare, runShare: runShare, runs: runs.length };
  }

  /* ---- OCR hyphenation ------------------------------------------------- *
   * An archive.org OCR layer keeps the printed line breaks, hyphens and all
   * ("at the commence-" / "ment."), and a hyphen in the middle of a word is
   * the one thing no downstream rule can undo. A short fragment before the
   * hyphen is a real hyphenated crochet token and keeps its hyphen ("next ch-"
   * / "sp" is "ch-sp", not "chsp"); a long one is a split word. */
  var HYPHEN_END_RE = /([A-Za-z]+)-$/;
  var LOWER_START_RE = /^[a-z]/;
  var DEHYPHEN_MIN = 4;

  function joinHyphenated(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var cur = lines[i];
      var m = HYPHEN_END_RE.exec(cur);
      var next = i + 1 < lines.length ? lines[i + 1] : null;
      if (m && next && LOWER_START_RE.test(next)) {
        var glue = m[1].length >= DEHYPHEN_MIN ? cur.slice(0, -1) : cur;
        out.push(glue + next);
        i++;
        continue;
      }
      out.push(cur);
    }
    return out;
  }

  function friendlyError(err) {
    var name = (err && err.name) || '';
    var msg = (err && err.message) || '';
    if (name === 'AbortError') return err;   // the user pressed Cancel
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
   * @param {{onProgress?: function(number, number), maxPages?: number,
   *          signal?: {cancelled:boolean}|AbortSignal}} [opts]
   * @returns {Promise<{text:string, pages:number, pagesTotal:number,
   *          chars:number, columnsDetected:number, emptyPages:number[]}>}
   */
  function extract(file, opts) {
    opts = opts || {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var signal = opts.signal || null;
    var maxPages = (typeof opts.maxPages === 'number' && opts.maxPages > 0)
      ? Math.floor(opts.maxPages) : 0;
    if (!file) return Promise.reject(new Error('No file to read.'));
    if (isCancelled(signal)) return Promise.reject(abortError());

    var lib, doc;
    return loadLib()
      .then(function (l) {
        lib = l;
        return readArrayBuffer(file);
      })
      .then(function (buf) {
        if (isCancelled(signal)) throw abortError();
        // The ArrayBuffer goes straight in: pdf.js accepts one, and the
        // second `new Uint8Array(buf)` copy used to double peak memory on
        // exactly the big files least able to afford it (06 #6).
        return lib.getDocument({
          data: buf,
          isEvalSupported: false,
          disableFontFace: true
        }).promise;
      })
      .then(function (pdf) {
        doc = pdf;
        var docPages = pdf.numPages || 0;
        var total = maxPages ? Math.min(maxPages, docPages) : docPages;
        var pages = [];
        var columnsDetected = 0;
        var rawSample = "";
        var chain = Promise.resolve();

        var makeStep = function (p) {
          return function () {
            if (isCancelled(signal)) throw abortError();
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
                var res = pageLines(tc.items || [], width, height, page.rotate);
                if (res.split) columnsDetected++;
                // The garble verdict is taken here, on the RAW line text: the
                // control codes that give a broken subset font away are about
                // to be stripped out by normUnicode.
                res.lines.forEach(function (l) {
                  if (rawSample.length < GARBLE_SAMPLE) rawSample += l.text + '\n';
                });
                pages.push({
                  number: p,
                  lines: res.lines.map(function (l) {
                    return { text: normUnicode(l.text), margin: l.margin };
                  })
                });
                if (typeof page.cleanup === 'function') page.cleanup();
              });
            });
          };
        };

        for (var p = 1; p <= total; p++) chain = chain.then(makeStep(p));

        return chain.then(function () {
          var cleaned = dropRunningFurniture(pages);
          var numbers = pages.map(function (pg) { return pg.number; });
          var emptyPages = emptyPageNumbers(cleaned, numbers);
          var blocks = cleaned.map(function (lines, i) {
            return '=== PAGE ' + pages[i].number + ' ===\n' + joinHyphenated(lines).join('\n');
          });
          var text = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
          var body = text.replace(/^=== PAGE \d+ ===$/gm, '').replace(/\s/g, '');
          if (!body.length) {
            throw new Error('Couldn’t read that PDF (it may be scanned images).');
          }
          return {
            text: text,
            pages: total,
            pagesTotal: docPages,
            chars: text.length,
            columnsDetected: columnsDetected,
            emptyPages: emptyPages,
            garbled: garbleScore(rawSample).garbled
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
                var res = pageLines(tc.items || [], size.width, size.height, page.rotate);
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
    SIZE_WARN_BYTES: SIZE_WARN_BYTES,
    MIN_PAGE_CHARS: MIN_PAGE_CHARS,
    /** Exposed for the dev fixtures page / tests. */
    _emptyPageNumbers: emptyPageNumbers,
    _normUnicode: normUnicode,
    _pageLines: pageLines,
    _fixLigatures: fixLigatures,
    _buildRows: buildRows,
    _rowText: rowText,
    _pageLooksSpaced: pageLooksSpaced,
    _dropRotated: dropRotated,
    _dominantHeight: dominantHeight,
    _medianPitch: medianPitch,
    _labelRows: labelRows,
    _garbleScore: garbleScore,
    _joinHyphenated: joinHyphenated,
    _isPageStamp: isPageStamp,
    _findGaps: findGaps
  };
})();
