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
 *   PdfText.open(file, { signal }) → a handle that keeps the document open
 *     for page images, with textOf(n), renderPage(n) and extract(opts) (the
 *     same pipeline as PdfText.extract); see section 7.
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

  // a © line survives only as a sentence this long, in lower case, that
  // does not name a year, a site or rights ("WHEAT STITCH CROCHET CARDIGAN
  // PAGE 12 © BRIANA K DESIGNS" is a running head)
  var COPYRIGHT_MIN_PROSE = 10;
  var COPYRIGHT_RE = /copyright|rights|reserved|\b(?:19|20)\d{2}\b|www\.|\.com\b|\.co\.uk\b|ltd|inc\b/i;

  function isFurniture(line) {
    if (!line) return true;
    // A © line is a copyright notice when it reads like one. OCR also reads
    // a smudge as "©" in the middle of an instruction (crochet-archive-
    // weldons-v24 p8: "* 1 tr. between next two treble, 2 ch. Repeat from *
    // to end of round."), and that line is the pattern.
    if (line.indexOf('©') >= 0 &&
        (line.split(/\s+/).length < COPYRIGHT_MIN_PROSE || !/[a-z]{3}/.test(line) ||
         COPYRIGHT_RE.test(line))) return true;
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
  /* Text at a slant is never content. The Antique Pattern Library stamps a
   * diagonal "Antique Pattern Library" watermark across every scan, and a
   * round badge sets one glyph per angle ("NEW AIDA COLOUR", xs-dmc-2173
   * p1). Kept, the watermark is the only text on an image page, so the page
   * was never reported empty and a book with no text layer at all was
   * accepted instead of refused. Only text turned a right angle can be a
   * page set sideways. */
  function isSlanted(it) {
    var t = it && it.transform;
    if (!t || t.length < 6) return false;
    var a = Math.abs(t[0]), b = Math.abs(t[1]);
    return Math.min(a, b) > Math.max(a, b) * 0.2;
  }

  function dropRotated(items) {
    items = items.filter(function (it) { return !isSlanted(it); });
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

  /* Superscripts and subscripts. A stacked fraction is set as a small raised
   * numerator, a fraction slash U+2044 and a small denominator on the
   * baseline ("26 (27 ¹⁄₂, 28 ³⁄₄)"). The numerator sits 3-4 pt above the
   * baseline, outside Y_TOLERANCE, so it used to become a row of its own
   * ("1 3" printed above "Finished Size 26 (27 ⁄2 , 28 ⁄4)") and every
   * half size in knit-interweave-lace, knit-interweave-8-socks,
   * other-weaving-handwoven and the FreeSpirit yardage table lost its
   * numerator. A glyph that is (a) much smaller than a neighbouring row's
   * text, (b) close enough to that row's baseline that it overlaps the
   * row's own glyphs, and (c) touching one of the row's items along the
   * line, can only be a script of that row, so it joins it. A separate line
   * of fine print can never satisfy (b) without overprinting the line below. */
  var SCRIPT_MAX_SIZE = 0.75;   // a script is at most this share of the row's text
  var SCRIPT_RISE = 0.6;        // a superscript's baseline sits up to this many heights up
  var SCRIPT_DROP = 0.35;       // ...a subscript's this many heights down
  var SCRIPT_TOUCH = 0.3;       // ...and it touches a row item within this many heights

  function rowInkHeight(row) {
    var h = 0;
    for (var i = 0; i < row.items.length; i++) {
      if (row.items[i].str.replace(/\s/g, '') && row.items[i].h > h) h = row.items[i].h;
    }
    return h;
  }

  function rowsOverlap(a, b) {
    for (var i = 0; i < a.items.length; i++) {
      var p = a.items[i];
      if (!p.str.replace(/\s/g, '')) continue;
      for (var k = 0; k < b.items.length; k++) {
        var q = b.items[k];
        if (!q.str.replace(/\s/g, '')) continue;
        if (Math.min(p.end, q.end) - Math.max(p.x, q.x) > 1) return true;
      }
    }
    return false;
  }

  /** The glyphs of `row` small enough to be scripts of text `H` high. */
  function smallOf(row, H) {
    return { items: row.items.filter(function (it) { return it.h <= H * SCRIPT_MAX_SIZE; }) };
  }

  /** Move script glyphs into the row they belong to. `rows` sorted by order. */
  function attachScripts(rows) {
    for (var s = 0; s < rows.length; s++) {
      var src = rows[s];
      if (!src.items.length) continue;
      // Judged glyph by glyph: a numerator can share its baseline with other,
      // bigger text (FreeSpirit p2: the "1" of "4 1/8" sits level with the
      // "(M) (N) (O) (P)" swatch labels beside the table).
      var srcH = Infinity;
      src.items.forEach(function (it) { if (it.str.replace(/\s/g, '') && it.h < srcH) srcH = it.h; });
      if (!isFinite(srcH) || !(srcH > 0)) continue;
      // The nearest bigger rows just below (superscript) and just above
      // (subscript) this one, in reading order.
      var cands = [];
      for (var d = 0; d < rows.length; d++) {
        var t = rows[d];
        if (d === s || !t.items.length || Math.abs(t.order - src.order) > Math.max(srcH * 4, 20)) continue;
        var H = rowInkHeight(t);
        if (!(H > 0) || srcH > H * SCRIPT_MAX_SIZE) continue;
        var up = t.order - src.order;             // > 0: src is above t
        if (!((up > 0 && up <= H * SCRIPT_RISE) || (up < 0 && -up <= H * SCRIPT_DROP))) continue;
        // Scripts sit in the gaps of their row. A row whose glyphs lie ON
        // the other row's glyphs is a second line (two OCR lines drifting
        // into each other on a tilted scan), not its scripts.
        if (rowsOverlap(smallOf(src, H), t)) continue;
        cands.push({ row: t, H: H, sup: up > 0 });
      }
      if (!cands.length) continue;
      cands.sort(function (a, b) {
        return Math.abs(a.row.order - src.order) - Math.abs(b.row.order - src.order);
      });
      var keep = [];
      for (var i = 0; i < src.items.length; i++) {
        var it = src.items[i];
        var home = null;
        for (var c = 0; c < cands.length && !home; c++) {
          // (a space item goes with the script glyphs it sits between)
          if (it.str.replace(/\s/g, '') && it.h > cands[c].H * SCRIPT_MAX_SIZE) continue;
          var reach = cands[c].H * SCRIPT_TOUCH;
          var ti = cands[c].row.items;
          for (var k = 0; k < ti.length; k++) {
            if (!ti[k].str.replace(/\s/g, '')) continue;
            var after = it.x - ti[k].end, before = ti[k].x - it.end;
            if ((after >= -0.5 && after <= reach) || (before >= -0.5 && before <= reach)) {
              home = cands[c];
              break;
            }
          }
        }
        if (!home) { keep.push(it); continue; }
        it.script = home.sup ? 'sup' : 'sub';
        home.row.items.push(it);
        home.row.items.sort(function (a, b) {
          if (a.x !== b.x) return a.x - b.x;
          return a.end - b.end;
        });
      }
      src.items = keep;
    }
  }

  /* Faux bold. Some generators (FreeSpirit / Anna Maria booklets) embolden
   * by drawing every glyph run twice, a fraction of a point apart, and pdf.js
   * hands back both copies: "⁄22", "Finished|Finished Block Sizes:". Two runs
   * that start at the same place on the same line cannot both be ink a
   * reader sees, so the shorter copy of a run the other one starts with is
   * dropped. */
  var OVERPRINT_SLOP = 0.15;    // "the same place" = within this many heights

  function dropOverprint(row) {
    if (row.items.length < 2) return;
    var out = [];
    for (var i = 0; i < row.items.length; i++) {
      var it = row.items[i];
      var s = it.str.replace(/^\s+|\s+$/g, '');
      if (!s) { out.push(it); continue; }
      var dup = false;
      for (var j = out.length - 1; j >= 0 && !dup; j--) {
        var o = out[j];
        if (it.x - o.x > Math.max(1, OVERPRINT_SLOP * Math.max(it.h, o.h))) break;
        var os = o.str.replace(/^\s+|\s+$/g, '');
        if (!os) continue;
        if (os === s || os.indexOf(s) === 0) { dup = true; break; }   // it is the copy
        if (s.indexOf(os) === 0) { out[j] = it; dup = true; }          // o was the short copy
      }
      if (!dup) out.push(it);
    }
    row.items = out;
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
      row.items.push({ x: x, end: x + w, h: h, str: it.str, turned: isRotated(it) !== sideways });  // turned: against the page
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
    attachScripts(rows);
    rows.forEach(dropOverprint);
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

  /* A tracked heading on an ordinary page. pageLooksSpaced() only repairs a
   * page that is letter-spaced throughout, which keeps an "A B C" photo key
   * intact, but it leaves a display heading such as "C U T T I N G
   * D I R E C T I O N S" (sew-agf-catwalk-quilt) spaced out, and a spaced
   * heading then reads as a row of photo letters and is thrown away as page
   * furniture. A line made only of spaced-out runs is a tracked word when
   * one run is at least four glyphs long and every run looks like a word:
   * not a key ("A B C D", "1 2 3 4": each glyph one more than the last) and
   * not a chart row (the same symbol three times running). */
  var TRACKED_MIN_GLYPHS = 4;

  function spacedRunIsWord(s) {
    var g = s.replace(/ /g, '');
    if (/(.)\1\1/.test(g)) return false;                 // chart symbols repeat
    var rising = true;
    for (var i = 1; i < g.length; i++) {
      if (g.charCodeAt(i) !== g.charCodeAt(i - 1) + 1) { rising = false; break; }
    }
    return !rising && /[AEIOUYaeiouy0-9]/.test(g);
  }

  // The page's body text height while pageLines() runs (it is synchronous): a
  // tracked run set far below it is a logo tagline ("S E W I N G  P A T T E R N S"
  // at 3.3 pt under the swoon logo, sew-swoon-mabel-bag), not a heading, and
  // stays spaced out (and is then dropped with the other photo lettering).
  var pageBodyH = 0;
  var TRACKED_MIN_SIZE = 0.8;

  function rowIsTracked(row) {
    var long = false, runs = 0;
    for (var i = 0; i < row.items.length; i++) {
      var s = row.items[i].str;
      if (!s.replace(/\s/g, '')) continue;
      if (pageBodyH > 0 && row.items[i].h < pageBodyH * TRACKED_MIN_SIZE) return false;
      if (!SPACED_ITEM_RE.test(s) || !spacedRunIsWord(s)) return false;
      runs++;
      if (s.replace(/ /g, '').length >= TRACKED_MIN_GLYPHS) long = true;
    }
    return runs > 0 && long;
  }

  function rowText(row, deglyph) {
    if (!deglyph && rowIsTracked(row)) deglyph = true;
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
        // The numerator of a stacked fraction touches the whole number in
        // front of it ("27" + "¹⁄₂"): keep them apart, "27 1/2" not "271/2".
        // The numerator may also sit on the baseline, just smaller ("8|1|⁄|2",
        // knit-interweave-8-socks): size tells it from the whole number.
        if (glued && (it.script === 'sup' || it.h < prev.h * SCRIPT_MAX_SIZE) &&
            !prev.script && /\d$/.test(prev.str) &&
            (/^\d+[⁄\/]\d*$/.test(str) ||         // "7/8" set as one run
             (/^\d+$/.test(str) && row.items[i + 1] && /^[⁄\/]/.test(row.items[i + 1].str)))) {
          glued = false;
        }
        // Two runs drawn over each other (the size layers of a nested pattern
        // sheet print "SIZE 12M", "SIZE 18M" ... at one spot, sew-tianas-jogger)
        // are separate words, however little room the join leaves.
        if (glued && !it.turned && !prev.turned && it.x < prev.x + (prev.end - prev.x) / 2 &&
            str.replace(/\s/g, '').length >= 2 && prev.str.replace(/\s/g, '').length >= 2) glued = false;
        if (!glued) out += ' ';
      }
      out += str;
      prev = { str: str, x: it.x, end: it.end, h: it.h, script: it.script, turned: it.turned };
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
  /* A shade code and its name: a colour key cell. */
  var LABEL_SHADE_RE = /(?:^|\s)\d{3,5}\s+[A-Z][a-z]/;
  /* A sentence: capital (or a repeat star) to full stop. */
  var LABEL_SENTENCE_RE = /^[*"(]?[A-Z][\s\S]*[.!]["')]?$/;
  var LABEL_SENTENCE_WORDS = 5;

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
    // A shade number with its name ("3282 Spice", "3491 Burnt Orange") is a
    // colour key cell set under its swatch, not a caption
    // (crochet-kingcole-pumpkins p2 lost five of its eight colours).
    if (LABEL_SHADE_RE.test(text)) return false;
    var h = 0;
    for (var i = 0; i < row.items.length; i++) {
      if (row.items[i].h > h) h = row.items[i].h;
    }
    // A whole sentence at body size is an instruction, even alone between
    // two photos ("Cut off your zipper excess.", sew-rileyblake-triple-t-tote
    // p4; "*Then yarn over, and complete a double crochet stitch.").
    if (!(bodyH > 0 && h <= bodyH * LABEL_SMALL_FONT) && LABEL_SENTENCE_RE.test(text) &&
        text.split(/\s+/).length >= LABEL_SENTENCE_WORDS) {
      return false;
    }
    // A section heading stands alone between two blocks of rows exactly like
    // a caption does, and the one thing that always separates them is size:
    // a heading is set BIGGER than the body text, a caption never is.
    if (bodyH > 0 && h > bodyH * LABEL_BIG_FONT) return false;
    // fine print sitting apart from the text is a caption whatever it says
    if (bodyH > 0 && h <= bodyH * LABEL_SMALL_FONT) return true;
    return text.split(/\s+/).length <= LABEL_MAX_WORDS && text.length <= LABEL_MAX_CHARS;
  }

  /* A tip bubble is not a callout. bear p2 sets "You can use a different /
   * weight of yarn for this / project, and adjust for the / appropriate hook
   * size. Be / aware that this will affect / the finished size." in a circle
   * beside the materials: six short lines, cut off from everything, so every
   * line passed as a caption and the whole note vanished. What a callout never
   * is, is one sentence wrapped over several lines: its lines do not run on
   * into each other in lower case. */
  var PROSE_MIN_LINES = 3;
  var PROSE_MIN_WORDS = 12;

  function readsAsProse(rows, deglyph) {
    if (rows.length < PROSE_MIN_LINES) return false;
    var texts = rows.map(function (r) { return rowText(r, deglyph); });
    // Words, not counts: "5 4 3 2 1" beside a callout is not prose.
    var words = texts.join(' ').split(/\s+/).filter(function (w) {
      return /[A-Za-z]{2,}/.test(w);
    }).length;
    if (words < PROSE_MIN_WORDS) return false;
    var runOn = 0;
    for (var i = 1; i < texts.length; i++) {
      if (/^[a-z]/.test(texts[i]) && !/[.:;!?]$/.test(texts[i - 1])) runOn++;
    }
    return runOn * 3 >= (texts.length - 1) * 2;
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
      if (readsAsProse(blocks[i].map(function (idx) { return rows[idx]; }), deglyph)) continue;
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

  /* Full-width blocks above, below or between the columns. A gutter is found
   * over the whole region, so a box that runs the full width under two
   * columns (bear p2: the "Legal" paragraph under the Yarn / Abbreviations
   * boxes) used to be cut down the gutter like everything else: the left
   * halves of its lines were read at the end of the left column and the
   * right halves at the end of the right one ("This pattern is intended for
   * personal" ... "use only. All patterns, designs and photos included").
   * A line whose ink runs straight across the gutter is not in either
   * column. Two or more such lines in a row (a paragraph, a table row pair)
   * or any number at the very top or bottom of the region are a full-width
   * band: the region is cut into horizontal bands there, the bands between
   * them are split at the same gutter, and the full-width bands are read
   * whole, in place. A single bridging line in the middle of the columns is
   * left alone, since one long line poking into the gutter proves nothing. */
  var BRIDGE_GAP = 0.6;       // a gap narrower than this many heights is a word space
  var BAND_MIN_ROWS = 2;      // ...a full-width band in mid page is this many lines
  // ...and the run of words that crosses the gutter has to be a real share of
  // the region wide: a three-word callout centred over the gutter on a photo
  // ("4 sc between", crochet-baphomet p4) crosses it too, and is no band.
  var BRIDGE_MIN_SPAN = 0.3;

  function bridgesGutter(row, mid, width) {
    // Ink only: a justified line's trailing space item reaches into the
    // gutter without the line crossing it.
    var ink = row.items.filter(function (it) { return it.str.replace(/\s/g, ''); });
    var h = 0, i;
    for (i = 0; i < ink.length; i++) if (ink[i].h > h) h = ink[i].h;
    var space = Math.max(3, (h || 10) * BRIDGE_GAP);
    var start = null, end = null;
    for (i = 0; i < ink.length; i++) {
      var it = ink[i];
      if (start === null || it.x - end >= space) { start = it.x; end = it.end; }
      else if (it.end > end) end = it.end;
      // the run so far reaches across the gutter
      if (start < mid - 0.5 && end > mid + 0.5) {
        var j = i + 1;
        while (j < ink.length && ink[j].x - end < space) { if (ink[j].end > end) end = ink[j].end; j++; }
        return !(width > 0) || end - start >= width * BRIDGE_MIN_SPAN;
      }
    }
    return false;
  }

  /* Tables are not full-width bands. A table that the page's gutter runs
   * through (the Samford fabric table, the FreeSpirit yardage table, a
   * KG-Chart or Tiny Modernist colour key) keeps the column split it has
   * always had: the craft parsers read those blocks column by column and
   * zip them back themselves, and a key printed as side-by-side blocks
   * really is read block by block. So a line counts as crossing the gutter
   * only while it is prose: at most two runs of words, never a row of three
   * or more separate cells. (Zipping genuine one-record-per-row tables back
   * together here is left to a coordinated change with the parsers; see
   * docs/wave-e/pdftext-audit.md.) */
  var CELL_GAP = 1.0;         // a gap this many heights wide separates cells
  var TABLE_MIN_CELLS = 3;

  function cellCount(row) {
    var ink = row.items.filter(function (it) { return it.str.replace(/\s/g, ''); });
    var h = rowInkHeight(row) || 10;
    var n = 0, end = -Infinity;
    for (var i = 0; i < ink.length; i++) {
      if (ink[i].x - end >= Math.max(4, h * CELL_GAP)) n++;
      if (ink[i].end > end) end = ink[i].end;
    }
    return n;
  }

  /**
   * @returns {null|Array<{rows:Array, whole:boolean}>} null when nothing
   *   crosses the gutter as a block (the region is plain columns).
   */
  /* ...except a table that closes (or opens) the region under (or over)
   * the columns. The Samford fabric table runs the full width under a label
   * column and a text column, and split down the page's gutter its TOP /
   * METERS cells were read in front of the fabric prose, which cost the
   * notions list its elastic (sew-peppermint-samford-pants p5). A run of
   * table rows - three or more cells, cells on both sides, NOT the same
   * record repeated across the gutter (that is a key in newspaper columns,
   * xs-pokemon) - at the very end or start of the region, with the one-cell
   * row labels between them and any full-width line next to them, is read
   * whole as long as it is the smaller part of the region. */
  var TABLE_END_SHARE = 0.5;
  var TABLE_CELL_WORDS = 3;     // words a cell holds on average, at most

  function isTableRow(row, mid) {
    if (cellCount(row) < TABLE_MIN_CELLS) return false;
    var l = '', r = '';
    for (var i = 0; i < row.items.length; i++) {
      var it = row.items[i];
      if ((it.x + it.end) / 2 < mid) l += ' ' + it.str; else r += ' ' + it.str;
    }
    if (!l.replace(/\s/g, '') || !r.replace(/\s/g, '')) return false;
    // cells are a word or three; three columns of prose side by side are
    // three cells too, of whole lines (crochet-stylecraft-hex-socks p3)
    if (l.split(/\s+/).filter(Boolean).length + r.split(/\s+/).filter(Boolean).length >
        cellCount(row) * TABLE_CELL_WORDS) return false;
    // a record is a few tokens ("N(Nw)"); a header of single words
    // ("METERS YARDS | METERS YARDS") repeats without being one
    var ls = cellShape(l), rs = cellShape(r);
    return Math.min(ls.length, rs.length) < 3 || !repeatsShape(ls, rs);
  }

  function tableEnds(rows, mid, width, bridge, whole) {
    var n = rows.length, tab = [], i, any = false;
    for (i = 0; i < n; i++) tab.push(isTableRow(rows[i], mid));
    var inRun = function (k) {
      if (bridge[k] || tab[k]) return true;
      return k > 0 && k + 1 < n && tab[k - 1] && tab[k + 1] && cellCount(rows[k]) <= 1;
    };
    var mark = function (from, to) {
      var t = 0, k;
      for (k = from; k <= to; k++) if (tab[k]) t++;
      if (t < 2 || to - from + 1 > n * TABLE_END_SHARE) return;
      for (k = from; k <= to; k++) whole[k] = true;
      any = true;
    };
    var k = n - 1;
    while (k >= 0 && inRun(k)) k--;
    if (k < n - 1) mark(k + 1, n - 1);
    k = 0;
    while (k < n && inRun(k)) k++;
    if (k > 0) mark(0, k - 1);
    return any;
  }

  function fullWidthBands(rows, mid, width) {
    var n = rows.length, i;
    var bridge = [];
    for (i = 0; i < n; i++) bridge.push(cellCount(rows[i]) < TABLE_MIN_CELLS && bridgesGutter(rows[i], mid, width));
    var whole = [];
    for (i = 0; i < n; i++) whole.push(false);
    var any = false;
    any = tableEnds(rows, mid, width, bridge, whole) || any;
    i = 0;
    while (i < n) {
      if (!bridge[i]) { i++; continue; }
      var j = i;
      while (j + 1 < n && bridge[j + 1]) j++;
      if (j - i + 1 >= BAND_MIN_ROWS || i === 0 || j === n - 1) {
        // The short last line of a full-width paragraph ("Willow&Wild.
        // Copyright 2024.") does not reach the gutter, but it follows the
        // block at the block's own line pitch.
        if (j > i) {
          var pitch = (rows[j].order - rows[i].order) / (j - i);
          // One line only, and only when nothing else shares its baseline:
          // below a full-width intro the next rows are the two columns.
          if (j + 1 < n && !bridge[j + 1] &&
              rows[j + 1].order - rows[j].order <= pitch * 1.3 &&
              !(j + 2 < n && rows[j + 2].order - rows[j + 1].order < pitch * 0.5)) j++;
        }
        for (var k = i; k <= j; k++) whole[k] = true;
        // A heading set on one side just above the block belongs to it
        // ("Legal" over the legal paragraph): it sits closer to the block
        // than to whatever is above it.
        if (i >= 1 && !bridge[i - 1]) {
          var gapIn = rows[i].order - rows[i - 1].order;
          var gapUp = i >= 2 ? rows[i - 1].order - rows[i - 2].order : Infinity;
          if (gapIn > 0 && gapIn < gapUp) whole[i - 1] = true;
        }
        any = true;
      }
      i = j + 1;
    }
    if (!any) return null;
    var bands = [];
    for (i = 0; i < n; i++) {
      var last = bands[bands.length - 1];
      if (last && last.whole === whole[i]) last.rows.push(rows[i]);
      else bands.push({ rows: [rows[i]], whole: whole[i] });
    }
    return bands;
  }

  /* Side-by-side key blocks. A colour key printed as three blocks of
   * "symbol | colour | skeins" (xs-dmc-2168: "162 x 1 | 722 x 1 | 946 x 1")
   * has a clear band inside every record as well as between the records,
   * and the widest band was the one inside: the key came out as a list of
   * codes, then "x1 722 x1" rows pairing one block's skeins with the next
   * block's colour. The band that falls BETWEEN records is the one where
   * what is left of it and what is right of it have the same shape, one
   * record or several of the same kind (cellShape / repeatsShape), so a
   * candidate that does that on most rows goes first. */
  var RECORD_SHARE = 0.6;

  function cellShape(s) {
    // letters first: the digit placeholder is itself a letter
    return s.replace(/[A-Za-zÀ-ɏ]+/g, 'w').replace(/\d+(?:[.,\/]\d+)*/g, 'N').replace(/\s+/g, '');
  }

  function repeatsShape(a, b) {
    if (!a || !b) return false;
    var short = a.length <= b.length ? a : b, long = a.length <= b.length ? b : a;
    if (long.length % short.length) return false;
    for (var i = 0; i < long.length; i += short.length) {
      if (long.substr(i, short.length) !== short) return false;
    }
    return true;
  }

  function recordShare(rows, mid) {
    var both = 0, same = 0;
    for (var r = 0; r < rows.length; r++) {
      var l = '', rt = '';
      for (var i = 0; i < rows[r].items.length; i++) {
        var it = rows[r].items[i];
        if ((it.x + it.end) / 2 < mid) l += ' ' + it.str; else rt += ' ' + it.str;
      }
      l = cellShape(l); rt = cellShape(rt);
      if (!l || !rt) continue;
      both++;
      // a record is more than one bare token: "N" | "N" proves nothing
      if (Math.min(l.length, rt.length) >= 2 && repeatsShape(l, rt)) same++;
    }
    return both >= MIN_COLUMN_LINES ? same / both : 0;
  }

  /* ...and inside one record the band between "162" and "x 1" is a cell
   * wall, not a gutter: nearly every row has ink on both sides of it, on the
   * same baseline, and each side is a token or two. Prose columns that share
   * baselines carry whole lines of words on each side. */
  var CELL_WALL_PAIRED = 0.8;
  var CELL_WALL_TOKENS = 2;

  function isCellWall(rows, mid) {
    var both = 0, withInk = 0, lt = [], rt = [];
    for (var r = 0; r < rows.length; r++) {
      var l = 0, rr = 0;
      for (var i = 0; i < rows[r].items.length; i++) {
        var it = rows[r].items[i];
        var toks = it.str.split(/\s+/).filter(Boolean).length;
        if (!toks) continue;
        if ((it.x + it.end) / 2 < mid) l += toks; else rr += toks;
      }
      if (!l && !rr) continue;
      withInk++;
      if (l && rr) { both++; lt.push(l); rt.push(rr); }
    }
    if (!withInk || both < MIN_COLUMN_LINES || both < withInk * CELL_WALL_PAIRED) return false;
    var med = function (a) { a.sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
    return med(lt) <= CELL_WALL_TOKENS && med(rt) <= CELL_WALL_TOKENS && recordShare(rows, mid) < RECORD_SHARE;
  }

  function preferRecordGaps(rows, gaps) {
    if (!gaps.length) return gaps;
    var first = [], rest = [];
    gaps.forEach(function (g) {
      if (isCellWall(rows, g.x)) return;
      (recordShare(rows, g.x) >= RECORD_SHARE ? first : rest).push(g);
    });
    return first.concat(rest);
  }

  /* Which side of the gutter each piece of a row goes to. Items used to be
   * placed one by one by their centre, so the last words of a line that
   * runs a little past the gutter were torn off it and read in the other
   * column ("... crochet hook" / "or size" landing in the middle of "1st
   * row", crochet-bernat-basketweave p1). Words closer together than a word
   * space are one run, and a run goes to one side, by its centre. Only ink
   * measures the gap: a justified line's trailing space item reaches into
   * the gutter. */
  function splitRow(row, mid) {
    var li = [], ri = [], run = [], lo = Infinity, hi = -Infinity, end = -Infinity;
    function flush() {
      if (!run.length) return;
      var c = isFinite(lo) ? (lo + hi) / 2 : (run[0].x + run[0].end) / 2;
      var side = c < mid ? li : ri;
      for (var k = 0; k < run.length; k++) side.push(run[k]);
      run = []; lo = Infinity; hi = -Infinity; end = -Infinity;
    }
    for (var i = 0; i < row.items.length; i++) {
      var it = row.items[i];
      var ink = !!it.str.replace(/\s/g, '');
      // a run turned against the page has no width along this line: alone
      if (it.turned) {
        flush();
        ((it.x + it.end) / 2 < mid ? li : ri).push(it);
        continue;
      }
      var space = Math.min(Math.max(3, it.h * 0.5), MIN_GAP_WIDTH * 0.8);
      if (ink && isFinite(end) && it.x - end >= space) flush();
      run.push(it);
      if (ink) {
        if (it.end > end) end = it.end;
        if (it.x < lo) lo = it.x;
        if (it.end > hi) hi = it.end;
      }
    }
    flush();
    return { left: li, right: ri };
  }

  function columnize(rows, x0, x1, budget) {
    if (budget.left <= 0 || rows.length < MIN_LINES_FOR_COLUMNS) {
      return { columns: [rows], split: false };
    }
    var gaps = preferRecordGaps(rows, findGaps(rows, x0, x1));
    // Only a real two-column page, please: both sides need actual content.
    var share = Math.max(MIN_COLUMN_LINES, Math.ceil(rows.length * MIN_COLUMN_SHARE));

    for (var g = 0; g < gaps.length; g++) {
      var mid = gaps[g].x;
      var noisy = gaps[g].noisy;
      var left = [];
      var right = [];
      rows.forEach(function (row) {
        var parts = splitRow(row, mid);
        if (parts.left.length) left.push({ y: row.y, order: row.order, items: parts.left });
        if (parts.right.length) right.push({ y: row.y, order: row.order, items: parts.right });
      });
      if (left.length < share || right.length < share) continue;
      var wLeft = extentOf(left), wRight = extentOf(right);
      if (wLeft < MIN_COLUMN_WIDTH || wRight < MIN_COLUMN_WIDTH) continue;
      if (noisy && (x1 - x0) > 0 &&
          (wLeft < (x1 - x0) * NOISY_COLUMN_SHARE || wRight < (x1 - x0) * NOISY_COLUMN_SHARE)) {
        continue;                  // a table's cell wall, not a gutter
      }

      budget.left -= 1;
      var bands = fullWidthBands(rows, mid, x1 - x0);
      if (bands) {
        var cols = [];
        bands.forEach(function (band) {
          if (band.whole) { cols.push(band.rows); return; }
          var bl = [], br = [];
          band.rows.forEach(function (row) {
            var parts = splitRow(row, mid);
            if (parts.left.length) bl.push({ y: row.y, order: row.order, items: parts.left });
            if (parts.right.length) br.push({ y: row.y, order: row.order, items: parts.right });
          });
          var tag = function (side) {
            return function (c, idx) {
              c.group = side + Math.round(mid) + ':' + idx + '/' + (c.group || '');
              return c;
            };
          };
          if (bl.length) cols = cols.concat(columnize(bl, x0, mid, budget).columns.map(tag('L')));
          if (br.length) cols = cols.concat(columnize(br, mid, x1, budget).columns.map(tag('R')));
        });
        return { columns: cols, split: true };
      }
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

  /* Photo letters. Step photos are keyed "A", "B", "C" in big boxed capitals,
   * and one that happens to share a baseline with the text beside it is glued
   * onto that line: "Stuff the head until the desired firmness is C",
   * "Legs G" (bear p3, p5). A lone capital drawn much bigger than the body
   * text and standing well clear of its neighbours on the line is such a
   * key, not a word. (Alone on its line it is already page furniture.) A
   * drop cap is as big but touches the rest of its word, and a size table's
   * "S  M  L" header is set at body size, so neither is touched. */
  var PHOTO_LETTER_SIZE = 1.3;   // this many times the body text height
  var PHOTO_LETTER_CLEAR = 1;    // ...and this many of its own heights from any ink

  function dropPhotoLetters(rows, bodyH) {
    if (!(bodyH > 0)) return;
    rows.forEach(function (row) {
      var ink = row.items.filter(function (it) { return it.str.replace(/\s/g, ''); });
      if (ink.length < 2) return;
      var gone = [];
      // Never the first item: a capital that LEADS its line heads it ("X  DMC"
      // over a colour key's symbol column, xs-tinymodernist-foxy).
      for (var i = 1; i < ink.length; i++) {
        var it = ink[i];
        if (!/^\s*[A-Z]\s*$/.test(it.str) || it.h < bodyH * PHOTO_LETTER_SIZE) continue;
        var clear = it.h * PHOTO_LETTER_CLEAR;
        var before = i > 0 ? it.x - ink[i - 1].end : Infinity;
        var after = i + 1 < ink.length ? ink[i + 1].x - it.end : Infinity;
        if (before >= clear && after >= clear) gone.push(it);
      }
      if (gone.length) row.items = row.items.filter(function (it) { return gone.indexOf(it) < 0; });
    });
  }

  /* Invisible text. Shops stamp a 1 pt SKU line on every page
   * ("hobbii-pattern-sku:pattern-1572-252-9126"); nobody can read it and it is
   * not the pattern. Only on a page with normal-sized text to compare with,
   * so a chart set in tiny type throughout is never touched. */
  var INVISIBLE_H = 2;          // points
  var INVISIBLE_BODY = 6;       // ...on a page whose body text is at least this

  function dropInvisible(rows, bodyH) {
    if (!(bodyH >= INVISIBLE_BODY)) return;
    rows.forEach(function (row) {
      row.items = row.items.filter(function (it) {
        return !(it.h > 0 && it.h < INVISIBLE_H && it.str.replace(/\s/g, ''));
      });
    });
  }

  /* A page stamp printed over a line. KG-Chart sets "38 / 38" on the same
   * baseline as the last colour-key row, and the stamp used to be glued to
   * the floss number ("38 / 383756 (905 ct)", xs-pokemon-tr/bl/br). Stamps
   * were only ever recognised as whole lines, so the one run that says
   * "n / N" (n <= N) near the top or bottom of the sheet goes on its own. */
  // spaced "38 / 38" or "3 of 6", never a fraction cell such as "1/2"
  var STAMP_ITEM_RE = /^\s*(\d{1,3})\s+(?:\/|of)\s+(\d{1,3})\s*$/i;
  var STAMP_BAND = 0.12;

  function dropStampItems(rows, pageHeight, pageWidth) {
    if (rows.sideways) return;
    var h = pageHeight > 0 ? pageHeight : 792;
    rows.forEach(function (row) {
      if (row.items.length < 2) return;             // a lone stamp is a line: isPageStamp
      var at = row.y / h;
      if (at > STAMP_BAND && at < 1 - STAMP_BAND) return;
      row.items = row.items.filter(function (it) {
        var m = STAMP_ITEM_RE.exec(it.str);
        if (!m) return true;
        var n = parseInt(m[1], 10), total = parseInt(m[2], 10);
        return !(n >= 1 && total >= 2 && n <= total);
      });
    });
  }

  /* A side heading: capitals only, three letters at least ("NOTIONS", "FABRIC
   * REQUIREMENTS"). */
  var SIDE_HEADING_RE = /^(?=(?:[^A-Za-z]*[A-Z]){3})[A-Z0-9 &'’\/:,.()-]+$/;

  function pageLines(items, pageWidth, pageHeight, rotate) {
    var rows = buildRows(items, rotate);
    // Judge letter spacing on the whole page, before it is cut into columns.
    var deglyph = pageLooksSpaced(rows);
    // The body text size is judged on the whole page, before it is cut up.
    var bodyH = dominantHeight(rows);
    pageBodyH = bodyH;
    dropPhotoLetters(rows, bodyH);
    dropInvisible(rows, bodyH);
    dropStampItems(rows, pageHeight, pageWidth);
    var kept = rows.filter(function (row) { return row.items.length > 0; });
    kept.sideways = rows.sideways;
    kept.span = rows.span;
    kept.keySpan = rows.keySpan;
    rows = kept;

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
    // Page furniture goes first: a page number alone in the corner would
    // otherwise join the caption block beside it and, being set large,
    // vouch for it as a heading.
    var perCol = res.columns.map(function (col) {
      var kept = [];
      col.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (row) {
        var text = rowText(row, deglyph);
        // judged without control codes: "I\u001f I" is a row of diagram letters
        if (!text || isFurniture(text.replace(INVISIBLE_RE, ''))) return;
        var at0 = row.y - keyLo;
        var inMargin = at0 >= h * (1 - MARGIN_BAND) || at0 <= h * MARGIN_BAND;
        if (inMargin && BARE_NUMBER_RE.test(text)) return;     // a page number
        kept.push({ row: row, text: text });
      });
      return kept;
    });
    // Captions are judged per column, but a column cut into bands by a
    // full-width block (fullWidthBands) is still one column: its pieces are
    // judged together, or a band holding nothing but a callout block would
    // have no body text to be measured against (crochet-baphomet p3).
    var groups = {};
    res.columns.forEach(function (col, ci) {
      var g = col.group || ('c' + ci);
      (groups[g] = groups[g] || []).push(ci);
    });
    var dropped = res.columns.map(function () { return {}; });
    Object.keys(groups).forEach(function (g) {
      var members = [];
      groups[g].forEach(function (ci) {
        perCol[ci].forEach(function (k, ri) { members.push({ ci: ci, ri: ri, row: k.row }); });
      });
      members.sort(function (a, b) { return a.row.order - b.row.order; });
      var labels = labelRows(members.map(function (m) { return m.row; }), bodyH, deglyph);
      members.forEach(function (m, mi) { if (labels[mi]) dropped[m.ci][m.ri] = true; });
    });
    // A side heading is not a caption. Peppermint booklets set "FABRIC",
    // "INTERFACING", "NOTIONS" in a narrow column level with the first line
    // of the block each one names (sew-peppermint-samford-pants p5); alone in
    // their column, every one of them looked like a callout. A capitalised
    // label on exactly the baseline of a line kept in another column heads
    // that line.
    perCol.forEach(function (kept, ci) {
      kept.forEach(function (k, ri) {
        if (!dropped[ci][ri] || !SIDE_HEADING_RE.test(k.text)) return;
        for (var cj = 0; cj < perCol.length; cj++) {
          if (cj === ci) continue;
          for (var rj = 0; rj < perCol[cj].length; rj++) {
            if (!dropped[cj][rj] && Math.abs(perCol[cj][rj].row.y - k.row.y) <= 1.5) {
              dropped[ci][ri] = false;
              return;
            }
          }
        }
      });
    });
    perCol.forEach(function (kept, ci) {
      kept.forEach(function (k, rowIdx) {
        if (dropped[ci][rowIdx]) return;          // caption drawn over artwork
        // Baselines live in PDF space: high Y is the top of the page.
        var at = k.row.y - keyLo;
        var margin = at >= h * (1 - MARGIN_BAND) || at <= h * MARGIN_BAND;
        lines.push({ text: k.text, margin: margin, edge: h > 0 ? Math.min(at, h - at) / h : 1, pos: h > 0 ? at / h : 0.5 });
      });
    });
    pageBodyH = 0;
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

  /* Folios outside the margin band. A bare page number is dropped in the
   * top/bottom 8% already, but plenty of layouts set it a little higher
   * (crochet-turtle prints "1".."5" at y 69 of 842) and it then reached the
   * parser as a stray count. What proves a number is a folio is not where
   * it sits on one page but that, near the edge of every page, it runs in
   * step with the page number itself (value - page = the same offset). */
  var FOLIO_EDGE = 0.15;        // within this share of the page from top or bottom

  function folioOffset(pages) {
    var tally = {};
    pages.forEach(function (p) {
      var seen = {};
      p.lines.forEach(function (l) {
        if (!(l.edge <= FOLIO_EDGE) || !BARE_NUMBER_RE.test(l.text)) return;
        var off = parseInt(l.text, 10) - p.number;
        if (seen[off]) return;
        seen[off] = true;
        tally[off] = (tally[off] || 0) + 1;
      });
    });
    var best = null, bestN = 0;
    for (var k in tally) {
      if (tally[k] > bestN) { bestN = tally[k]; best = parseInt(k, 10); }
    }
    return bestN >= Math.max(3, Math.ceil(pages.length * 0.4)) ? best : null;
  }

  function isFolio(l, p, offset) {
    return offset !== null && l.edge <= FOLIO_EDGE && BARE_NUMBER_RE.test(l.text) &&
      parseInt(l.text, 10) - p.number === offset;
  }

  /* Furniture that is not in the margin. Plenty of it never reaches the
   * top or bottom 8%: KG-Chart prints "(This chart is printed using KG-Chart
   * LE for Cross Stitch.)" at 10% of the sheet, the Antique Pattern Library
   * stamps "FREE DISTRIBUTION ONLY - NOT FOR SALE" across the middle of every
   * scan, pattern sheets repeat "DON'T TRIM OFF - ASSIST'S IN PATTERN
   * ASSEMBLY", a column split puts a footer's pieces mid-page. A line long
   * enough to say something that turns up on most pages of the document AT
   * THE SAME HEIGHT on the sheet is furniture. The height matters: an
   * amigurumi pattern repeats "Rnd 2: 2 sc in each st around. (12)" in every
   * part on every page (crochet-panda), but wherever the part happens to
   * start, never in one fixed place. */
  var ANYWHERE_SHARE = 0.6;
  var ANYWHERE_MIN_KEY = 12;
  var ANYWHERE_SLOTS = 30;      // the sheet's height in slots of ~3%

  function anywhereKeys(pages) {
    var counts = Object.create(null), out = Object.create(null);
    pages.forEach(function (p) {
      var seen = Object.create(null);
      p.lines.forEach(function (l) {
        var key = marginKey(l.text);
        if (key.length < ANYWHERE_MIN_KEY) return;
        var slot = Math.round((l.pos || 0) * ANYWHERE_SLOTS);
        // a slot either side, so a line drifting a point or two still counts
        for (var s = slot - 1; s <= slot + 1; s++) {
          var id = key + '@' + s;
          if (seen[id]) continue;
          seen[id] = true;
          counts[id] = (counts[id] || 0) + 1;
        }
      });
    });
    var need = Math.max(3, Math.ceil(pages.length * ANYWHERE_SHARE));
    for (var k in counts) if (counts[k] >= need) out[k] = true;
    return out;
  }

  function isAnywhereFurniture(l, marks) {
    var key = marginKey(l.text);
    if (key.length < ANYWHERE_MIN_KEY) return false;
    var slot = Math.round((l.pos || 0) * ANYWHERE_SLOTS);
    return !!(marks[key + '@' + slot] || marks[key + '@' + (slot - 1)] || marks[key + '@' + (slot + 1)]);
  }

  function dropRunningFurniture(pages) {
    if (pages.length < 2) {
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
    // Two pages are enough when the line is word for word the same in the
    // margin of both: the two-page yarn-company leaflet is the commonest
    // pattern there is (crochet-redheart-persian-tiles: "For more ideas &
    // inspiration" and the running head landed inside BORDER Rnd 1).
    var threshold = pages.length < 3 ? 2 : Math.max(3, Math.ceil(pages.length * 0.4));
    // A head also counts on a page where it is glued to something else.
    // Yarnspirations print the product code and the running head as one
    // footer line on some pages and two on others ("CAC0129-026985M | July
    // 5, 2019" + "CUFF TO CUFF CROCHET CARDIGAN | CROCHET" on p1-2, one line on
    // p3-4), so neither form alone ever reached the threshold.
    var marginKeys = pages.map(function (p) {
      return p.lines.filter(function (l) { return l.margin; }).map(function (l) { return marginKey(l.text); });
    });
    var contained = {};
    Object.keys(counts).forEach(function (k) {
      if (k.length < 8) return;
      contained[k] = marginKeys.filter(function (keys) {
        return keys.some(function (key) { return key.indexOf(k) >= 0; });
      }).length;
    });
    var heads = repeatedKeys(contained, threshold);
    var folio = folioOffset(pages);
    var everywhere = anywhereKeys(pages);
    return pages.map(function (p) {
      var kept = [];
      p.lines.forEach(function (l) {
        if (isFolio(l, p, folio)) return;
        if (isAnywhereFurniture(l, everywhere)) return;
        if (l.margin) {
          if (counts[marginKey(l.text)] >= threshold) return;
          if (isPageStamp(l.text)) return;
          // A running head with a code or an address glued on to it.
          var key = marginKey(l.text);
          var swallowed = false, rest = key;
          for (var i = 0; i < heads.length; i++) {
            if (key.indexOf(heads[i]) >= 0 && heads[i].length >= key.length * HEAD_SHARE) {
              swallowed = true;
              break;
            }
            rest = rest.split(heads[i]).join(' ');
          }
          // ...or two heads glued together, with nothing left but a date
          if (swallowed || (rest !== key && !/[a-z]{3,}/.test(rest.replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, '')))) return;
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
  // U+F0B7 is the Symbol font's bullet as a word processor maps it (private use
  // area): 81 of them led the materials lines of crochet-allfree-stitches-ebook.
  var BULLET_RE = /[•‣◦▪▫●○◾·‧⁃∙]/g;
  // The fraction slash of a stacked fraction (see attachScripts): "27 1⁄2".
  var FRACTION_SLASH_RE = /⁄/g;
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
      // An unmapped glyph between two lower-case letters is the "ti"
      // ligature, the one common ligature a subset font leaves without a
      // ToUnicode entry (sew-rileyblake-triple-t-tote "backs�tch",
      // "crea�ng").
      .replace(/([a-z])�([a-z])/g, '$1ti$2')
      .replace(BULLET_RE, '-')
      .replace(/(\d) ?⁄ ?(\d)/g, '$1⁄$2')
      // "71⁄2" is 7 1/2: nothing prints 71/2 with a fraction slash, so a
      // proper fraction glued to a whole number is split off it
      // (knit-interweave-8-socks "Finished Size 7 1/2 (9, 10 1/2)").
      .replace(/(\d)([1357]⁄(?:2|4|8|16)(?!\d))/g, '$1 $2')
      // ...and the same fraction typed with an ASCII slash inside one text
      // run ("Finished Size 71/2 (9, 101/2)", knit-interweave-8-socks). Only a
      // proper fraction in halves to sixteenths, after one or two digits, and
      // never inside a date ("21/4/2024").
      .replace(/(^|[^\d.\/])(\d{1,2})([1357]\/(?:2|4|8|16))(?![\d\/])/g, '$1$2 $3')
      .replace(FRACTION_SLASH_RE, '/')
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
  /* ---- OCR noise ------------------------------------------------------ *
   * `garbled` answers one question - did a font hand back glyph ids instead
   * of letters - and must stay false for a scan whose OCR layer is merely
   * poor (the craft fixtures pin that down). How poor is a second number:
   * the share of words that no typesetter prints, letters and digits mixed
   * inside a word ("co1npost", "tlh>IH>μra1nn1cs") or runs of odd symbols.
   * Additive (`ocrNoise`, 0..1, on the extract result): a UI can say "the
   * scan's text layer is unreliable" above ~0.25 without anything else
   * changing. xs-apl-dmc-puntomarca and -pointdemarque are the cases. */
  var NOISE_WORD_RE = /[A-Za-z][0-9][A-Za-z]|[0-9][A-Za-z]{2,}[0-9]|[^\x20-\x7e\xa0-ɏ‐-‧]|[<>{}\[\]\\|^~`_=][A-Za-z]|[!?;:,.]{2,}[A-Za-z]/;

  function ocrNoise(text) {
    var words = String(text || '').replace(/^=== PAGE \d+ ===$/gm, '').split(/\s+/).filter(function (w) {
      return w.length >= 3;
    });
    if (words.length < 50) return 0;
    var bad = 0;
    for (var i = 0; i < words.length; i++) if (NOISE_WORD_RE.test(words[i])) bad++;
    return Math.round(bad / words.length * 1000) / 1000;
  }

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

  /* ---- Hyphenation ------------------------------------------------------ *
   * An archive.org OCR layer keeps the printed line breaks, hyphens and all
   * ("at the commence-" / "ment."), and so does any justified booklet
   * ("sec-" / "tion", "pat-" / "tern", "fab-" / "ric"). A hyphen in the
   * middle of a word is the one thing no downstream rule can undo. What a
   * line-end hyphen must keep is a craft token: "next ch-" / "sp" is "ch-sp",
   * "X-" / "st" is "X-st", "3-" / "ch" stays. That used to be judged by length
   * alone (a fragment under four letters kept its hyphen), which kept
   * "sec-tion", "pat-tern", "re-duce" and "fab-ric" split. Now the hyphen stays
   * only when either side is a stitch or pattern abbreviation. And a joined
   * line that itself ends in a hyphen is joined again ("can-" / "not be"). */
  var HYPHEN_END_RE = /([A-Za-z]+)-$/;
  var LOWER_START_RE = /^[a-z]/;
  var CRAFT_TOKENS = ' ch chs sp sps sl st sts sc dc hdc htr tr dtr trtr ttr lp lps yo yoh yrh sk rnd rnds rep row rows ' +
    'inc dec tog pm sm rs ws k p kfb pfb ssk sk2p cn mc cc bo co blo flo fp bp fpdc bpdc fptr bptr fphdc ' +
    'bphdc fpsc bpsc tbl pu m1 x v wof ';

  function isCraftToken(w) {
    return CRAFT_TOKENS.indexOf(' ' + String(w).toLowerCase() + ' ') >= 0;
  }

  function joinHyphenated(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var cur = lines[i];
      for (;;) {
        var m = HYPHEN_END_RE.exec(cur);
        var next = i + 1 < lines.length ? lines[i + 1] : null;
        if (!(m && next && LOWER_START_RE.test(next))) break;
        var head = /^[A-Za-z]+/.exec(next)[0];
        var keep = isCraftToken(m[1]) || isCraftToken(head);
        cur = (keep ? cur : cur.slice(0, -1)) + next;
        i++;
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
    if (/reader|has been closed/i.test(msg)) return err instanceof Error ? err : new Error(msg);
    return new Error('Couldn’t read that PDF (it may be scanned images).');
  }

  /**
   * The extract() pipeline over a document that is already open: every page
   * read in order, then the cross-page running-head pass, unicode hygiene,
   * hyphen joins, `=== PAGE n ===` markers, emptyPages and the garble verdict.
   * Shared by extract() and by the open() handle's own extract(), so a craft
   * that keeps the document open for page images gets exactly the same text
   * (HANDOFF item 6: the per-page textOf route skipped the running-head pass).
   * Never destroys `doc`; the caller owns it.
   */
  function readDoc(doc, opts) {
    opts = opts || {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var signal = opts.signal || null;
    var maxPages = (typeof opts.maxPages === 'number' && opts.maxPages > 0)
      ? Math.floor(opts.maxPages) : 0;
    var docPages = doc.numPages || 0;
    var total = maxPages ? Math.min(maxPages, docPages) : docPages;
    var pages = [];
    var columnsDetected = 0;
    var rawSample = '';
    var chain = Promise.resolve();

    var makeStep = function (p) {
      return function () {
        if (isCancelled(signal)) throw abortError();
        if (onProgress) {
          try { onProgress(p, total); } catch (e) { /* UI errors are not our problem */ }
        }
        return doc.getPage(p).then(function (page) {
          return page.getTextContent().then(function (tc) {
            var size = pageSize(page);
            var res = pageLines(tc.items || [], size.width, size.height, page.rotate);
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
                return { text: normUnicode(l.text), margin: l.margin, edge: l.edge, pos: l.pos };
              })
            });
            if (typeof page.cleanup === 'function') page.cleanup();
          });
        });
      };
    };

    for (var p = 1; p <= total; p++) chain = chain.then(makeStep(p));

    return chain.then(function () {
      if (isCancelled(signal)) throw abortError();
      var cleaned = dropRunningFurniture(pages);
      var numbers = pages.map(function (pg) { return pg.number; });
      var emptyPages = emptyPageNumbers(cleaned, numbers);
      var blocks = cleaned.map(function (lines, i) {
        return '=== PAGE ' + pages[i].number + ' ===\n' + joinHyphenated(lines).join('\n');
      });
      var text = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
      var body = text.replace(/^=== PAGE \d+ ===$/gm, '').replace(/\s/g, '');
      // `allowEmpty`: a caller that also has the page IMAGES (a scanned
      // cross-stitch chart) still wants the result, empty text and all.
      if (!body.length && !opts.allowEmpty) {
        throw new Error('Couldn’t read that PDF (it may be scanned images).');
      }
      return {
        text: text,
        pages: total,
        pagesTotal: docPages,
        chars: text.length,
        columnsDetected: columnsDetected,
        emptyPages: emptyPages,
        garbled: garbleScore(rawSample).garbled,
        ocrNoise: ocrNoise(text)
      };
    });
  }

  /**
   * @param {File|Blob} file
   * @param {{onProgress?: function(number, number), maxPages?: number,
   *          signal?: {cancelled:boolean}|AbortSignal}} [opts]
   * @returns {Promise<{text:string, pages:number, pagesTotal:number,
   *          chars:number, columnsDetected:number, emptyPages:number[],
   *          garbled:boolean}>}
   */
  function extract(file, opts) {
    opts = opts || {};
    var signal = opts.signal || null;
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
        return readDoc(doc, opts);
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
   *   PdfText.open(file, { signal }) -> Promise<{
   *     doc,                       // the pdf.js PDFDocumentProxy
   *     numPages,
   *     textOf(pageNo)             -> Promise<string>            (same line
   *                                   grouping, column splitting and furniture
   *                                   dropping as extract, for one page; no
   *                                   unicode folding: the craft modules match
   *                                   chart glyphs against it byte for byte)
   *     extract({ onProgress, maxPages, signal, allowEmpty })
   *                                -> Promise<extract() result>  (the WHOLE
   *                                   extract pipeline on this document,
   *                                   including the cross-page running-head
   *                                   pass, emptyPages and garbled;
   *                                   `allowEmpty` resolves a text-free PDF
   *                                   with text '' instead of rejecting)
   *     renderPage(pageNo, { scale | maxWidth, signal }) -> Promise<HTMLCanvasElement>
   *     destroy()                  // release it when the sheet closes
   *   }>
   *
   * `signal` has the same contract as extract's ({ cancelled } or an
   * AbortSignal): checked before the file is read, before and after the
   * document is parsed (a cancel that lands while pdf.js is parsing destroys
   * the document instead of handing it out), and at the head of every
   * textOf / renderPage / extract page step for the life of the handle.
   * Cancelled work rejects with an Error whose .name is 'AbortError'.
   * HANDOFF item 14.
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
   * @param {{signal?: {cancelled:boolean}|AbortSignal}} [opts]
   * @returns {Promise<Object>}
   */
  function open(file, opts) {
    opts = opts || {};
    var signal = opts.signal || null;
    if (!file) return Promise.reject(new Error('No file to read.'));
    if (isCancelled(signal)) return Promise.reject(abortError());
    var lib;
    return loadLib()
      .then(function (l) {
        lib = l;
        if (isCancelled(signal)) throw abortError();
        return readArrayBuffer(file);
      })
      .then(function (buf) {
        if (isCancelled(signal)) throw abortError();
        return lib.getDocument({
          data: buf,
          isEvalSupported: false,
          disableFontFace: true
        }).promise;
      })
      .then(function (doc) {
        var destroyed = false;

        function release() {
          if (destroyed) return;
          destroyed = true;
          if (doc && typeof doc.destroy === 'function') {
            try { doc.destroy(); } catch (e) { /* ignore */ }
          }
        }

        // Cancelled while pdf.js was parsing: nobody will ever own this
        // document, so free it here rather than leak the worker's memory.
        if (isCancelled(signal)) {
          release();
          throw abortError();
        }

        /** An error to reject with, or null when the call may go ahead. */
        function guard(callSignal) {
          if (isCancelled(signal) || isCancelled(callSignal)) return abortError();
          if (destroyed) return new Error('That PDF has been closed.');
          return null;
        }

        function textOf(pageNo) {
          var stop = guard();
          if (stop) return Promise.reject(stop);
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

        function extractAll(xopts) {
          xopts = xopts || {};
          var stop = guard(xopts.signal);
          if (stop) return Promise.reject(stop);
          // Either signal stops the pass: the one the document was opened
          // with, or one given for this read only. Closing the handle too.
          var both = {};
          Object.defineProperty(both, 'cancelled', {
            get: function () {
              return isCancelled(signal) || isCancelled(xopts.signal) || destroyed;
            }
          });
          return readDoc(doc, {
            onProgress: xopts.onProgress,
            maxPages: xopts.maxPages,
            allowEmpty: !!xopts.allowEmpty,
            signal: both
          }).then(null, function (err) { throw friendlyError(err); });
        }

        function renderPage(pageNo, ropts) {
          ropts = ropts || {};
          var stop = guard(ropts.signal);
          if (stop) return Promise.reject(stop);
          var n = parseInt(pageNo, 10);
          if (!isFinite(n) || n < 1 || n > (doc.numPages || 0)) {
            return Promise.reject(new Error('No page ' + pageNo + ' in that PDF.'));
          }
          var stopped = function () {
            return isCancelled(signal) || isCancelled(ropts.signal) || destroyed;
          };
          return doc.getPage(n).then(function (page) {
            // Cancelled while pdf.js fetched the page: do not start drawing.
            var mid = guard(ropts.signal);
            if (mid) throw mid;
            var base = pageSize(page);
            var scale = 1;
            if (typeof ropts.scale === 'number' && ropts.scale > 0) {
              scale = ropts.scale;
            } else if (typeof ropts.maxWidth === 'number' && ropts.maxWidth > 0 && base.width > 0) {
              scale = ropts.maxWidth / base.width;
            }
            var vp = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(vp.width));
            canvas.height = Math.max(1, Math.round(vp.height));
            var ctx2d = canvas.getContext('2d');
            if (!ctx2d) return Promise.reject(new Error('This device cannot draw the page.'));
            var task = page.render({ canvasContext: ctx2d, viewport: vp });
            var done = task && task.promise ? task.promise : Promise.resolve();
            // A page can take seconds to draw (and never finishes while the
            // tab is not painting frames), so Cancel is watched DURING the
            // render: the pdf.js task is cancelled and this call rejects at
            // once with AbortError instead of waiting for the page.
            var watch = null;
            var aborted = new Promise(function (resolve, reject) {
              watch = setInterval(function () {
                if (!stopped()) return;
                clearInterval(watch);
                watch = null;
                if (task && typeof task.cancel === 'function') {
                  try { task.cancel(); } catch (e) { /* already finished */ }
                }
                reject(guard(ropts.signal) || abortError());
              }, 40);
            });
            var finish = function () {
              if (watch) { clearInterval(watch); watch = null; }
            };
            return Promise.race([done, aborted]).then(function () {
              finish();
              if (typeof page.cleanup === 'function') page.cleanup();
              var after = guard(ropts.signal);
              if (after) throw after;
              return canvas;
            }, function (err) {
              finish();
              if (typeof page.cleanup === 'function') { try { page.cleanup(); } catch (e) { /* ignore */ } }
              // pdf.js reports its own cancel as RenderingCancelledException.
              if (stopped() || (err && err.name === 'RenderingCancelledException')) {
                throw guard(ropts.signal) || abortError();
              }
              throw err;
            });
          });
        }

        return {
          doc: doc,
          numPages: doc.numPages || 0,
          textOf: textOf,
          extract: extractAll,
          renderPage: renderPage,
          destroy: release
        };
      })
      .then(null, function (err) {
        throw friendlyError(err);
      });
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
    _ocrNoise: ocrNoise,
    _joinHyphenated: joinHyphenated,
    _isPageStamp: isPageStamp,
    _findGaps: findGaps,
    _columnize: function (rows, x0, x1) { return columnize(rows, x0, x1, { left: MAX_COLUMNS - 1 }); },
    _attachScripts: attachScripts,
    _dropOverprint: dropOverprint,
    _fullWidthBands: fullWidthBands,
    _readsAsProse: readsAsProse,
    _rowIsTracked: rowIsTracked
  };
})();
