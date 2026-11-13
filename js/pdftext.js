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
  var COLUMN_PITCH = 150;         // ...and a wider sheet one per this many points
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
      row.items.push({ x: x, end: x + w, h: h, str: it.str, turned: isRotated(it) !== sideways,  // turned: against the page
        font: it.fontName || '', box: itemBox(it, w) });   // wave K: for layout() only, never read by the text pipeline
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

  /* A drop cap or a small-caps initial is its own run: the Interweave
   * books set "N" + "otes", "L" + "eg", "K" + "NITS", with a zero-width
   * space run between them, and the space came out in the word ("N otes",
   * "L eg": a part heading the knitting reader could not name). A space run
   * with no width between a lone capital and a run that touches it, set
   * at a different size from it, is not a word break. */
  var INITIAL_GAP = 0.12;
  var INITIAL_SIZE = 0.05;    // ...and the initial is set at its own size
  var INITIAL_MAX_RATIO = 1.6;

  function isInitialSpace(items, i) {
    var sp = items[i];
    if (sp.str.replace(/\s/g, '') || sp.end - sp.x > 0.5) return false;
    var a = items[i - 1], b = items[i + 1];
    if (!a || !b || !/^[A-Z]$/.test(a.str) || !/^[A-Za-z]/.test(b.str)) return false;
    var h = Math.max(a.h, b.h, 1);
    if (Math.abs(a.h - b.h) < h * INITIAL_SIZE) return false;
    // a drop cap two or more lines tall belongs to the line above
    if (a.h > b.h * INITIAL_MAX_RATIO) return false;
    var gap = b.x - a.end;
    return gap > -1 && gap < INITIAL_GAP * h;
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
      if (isInitialSpace(row.items, i)) continue;
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
   * 3a. Hidden text (text the page carries but nobody can see)
   *
   * Magazine PDFs place whole source pages into frames. The text layer
   * then holds everything on the placed page, including what the frame
   * clips away and what a later box is painted over, and pdf.js hands all
   * of it back with no visibility flag. knit-interweave-8-socks p4 places
   * the same page twice, 24 pt apart (every line came out twice: the first
   * copy's title is clipped off and its body is painted over by the
   * materials box of the second), p6 carries the clipped-off glossary that
   * p9 shows, p9 carries the covered-up pattern text of p6, and p8 the
   * figure numbers of drawings that are clipped out of view.
   *
   * Visibility is read from the page's operator list: a run of text is
   * hidden when (almost) none of its box lies inside the clip in force when
   * it is drawn, or when something opaque painted later covers its box: a
   * plain box fill (full alpha, normal blending, no soft mask, outside any
   * transparency group), or an image whose own pixels are opaque there
   * (sampled; never over text in render mode 3, which is an OCR layer
   * lying on top of its scan by design). The operator
   * list is not free (the worker decodes the page's images for it), so it
   * is only read for a page that shows the symptoms (see overlaySuspect and
   * crossPageSuspects).
   * ================================================================== */
  var HIDE_CLIP_SHARE = 0.25;    // hidden when less than this share is inside the clip
  var HIDE_COVER_SHARE = 0.9;    // ...or a later opaque fill covers this share of it

  function mulM(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  function applyM(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  /** Page-space box [x0, y0, x1, y1] of a box given in the space of `m`. */
  function boxM(m, x0, y0, x1, y1) {
    var p = [applyM(m, x0, y0), applyM(m, x1, y0), applyM(m, x0, y1), applyM(m, x1, y1)];
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    p.forEach(function (q) {
      if (q[0] < b[0]) b[0] = q[0];
      if (q[1] < b[1]) b[1] = q[1];
      if (q[0] > b[2]) b[2] = q[0];
      if (q[1] > b[3]) b[3] = q[1];
    });
    return b;
  }
  function boxCut(a, b) {
    if (!a) return b ? b.slice() : null;
    if (!b) return a.slice();
    return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  }
  function boxArea(b) {
    return b ? Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) : 0;
  }

  /* Only a BOX hides what is under it. A fill's bounding box says nothing
   * about how much of it is ink: text set as outlines on top of the same
   * text (other-weaving-handwoven p2, "= the 'you are here' square") has a
   * bounding box over the words and almost no ink. A box is one rectangle,
   * or a short path (a rounded rectangle) whose every point lies on the
   * edge of its bounding box. */
  var BOX_MAX_OPS = 12;

  function pathIsBox(ops, coords, mm, OPS) {
    if (!ops || !coords || !mm) return false;
    var w = mm[1] - mm[0], h = mm[3] - mm[2];
    if (!(w > 0 && h > 0)) return false;
    var rects = 0, other = 0;
    for (var i = 0; i < ops.length; i++) {
      if (ops[i] === OPS.rectangle) rects++;
      else if (ops[i] !== OPS.closePath) other++;
    }
    if (rects) return rects === 1 && !other;
    if (other > BOX_MAX_OPS) return false;
    var slack = Math.max(1, Math.min(w, h) * 0.12);
    for (var k = 0; k + 1 < coords.length; k += 2) {
      var x = coords[k], y = coords[k + 1];
      var dx = Math.min(Math.abs(x - mm[0]), Math.abs(x - mm[1]));
      var dy = Math.min(Math.abs(y - mm[2]), Math.abs(y - mm[3]));
      if (dx > slack && dy > slack) return false;
    }
    return true;
  }

  /**
   * Every text run of an operator list with its page-space box and whether
   * a reader can see it.
   * @param {{fnArray:number[], argsArray:Array}} ol  page.getOperatorList()
   * @param {Object} OPS  pdfjsLib.OPS
   * @param {function(string, number, number):?number} [imageAlpha] alpha
   *   (0-255) of image `id` at unit-square point (u, v), null if unknown
   * @returns {Array<{sx:number, sy:number, ex:number, ey:number,
   *                  box:number[], hidden:boolean}>}
   */
  function textVisibility(ol, OPS, imageAlpha) {
    var fns = (ol && ol.fnArray) || [], args = (ol && ol.argsArray) || [];
    var gs = { ctm: [1, 0, 0, 1, 0, 0], clip: null, ca: 1, normal: true, smask: false,
      fs: 10, cs: 0, ws: 0, hs: 1, lead: 0, rise: 0, mode: 0, group: 0 };
    var stack = [];
    var tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
    var lastPath = null, lastIsBox = false;
    var runs = [], fills = [];
    var copy = function (g) {
      var o = {};
      for (var k in g) o[k] = g[k];
      return o;
    };
    var moveText = function (x, y) {
      tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + x * tlm[0] + y * tlm[2], tlm[5] + x * tlm[1] + y * tlm[3]];
      tm = tlm.slice();
    };
    var show = function (glyphs) {
      if (!glyphs || !glyphs.length) return;
      var adv = 0, txt = '';
      for (var i = 0; i < glyphs.length; i++) {
        var gl = glyphs[i];
        if (typeof gl === 'number') { adv -= gl * gs.fs / 1000 * gs.hs; continue; }
        if (!gl) continue;
        var w = typeof gl.width === 'number' ? gl.width : 500;
        adv += (w * gs.fs / 1000 + gs.cs + (gl.isSpace ? gs.ws : 0)) * gs.hs;
        if (typeof gl.unicode === 'string') txt += gl.unicode;
      }
      var m = mulM(gs.ctm, tm);
      var s = applyM(m, 0, gs.rise), e = applyM(m, adv, gs.rise);
      var box = boxM(m, Math.min(0, adv), gs.rise - 0.2 * gs.fs, Math.max(0, adv), gs.rise + 0.8 * gs.fs);
      var hidden = false;
      if (gs.clip) {
        var a = boxArea(box);
        var inside = boxArea(boxCut(box, gs.clip));
        // a run with no extent (a lone space) is judged by its start
        hidden = a > 0 ? inside < a * HIDE_CLIP_SHARE
          : (s[0] < gs.clip[0] || s[0] > gs.clip[2] || s[1] < gs.clip[1] || s[1] > gs.clip[3]);
      }
      // Render mode 3 (invisible) is NOT hidden text: it is how every OCR
      // layer lies over its scan, and the scan shows those very words.
      runs.push({ sx: s[0], sy: s[1], ex: e[0], ey: e[1], box: box, text: txt, hidden: hidden,
        why: hidden ? 'clip' : '', ocr: gs.mode === 3 || gs.mode === 7, at: fills.length });
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + adv * tm[0], tm[5] + adv * tm[1]];
    };
    for (var i = 0; i < fns.length; i++) {
      var fn = fns[i], a = args[i] || [];
      switch (fn) {
        case OPS.save: stack.push(copy(gs)); break;
        case OPS.restore: if (stack.length) gs = stack.pop(); break;
        case OPS.transform: gs.ctm = mulM(gs.ctm, a); break;
        case OPS.paintFormXObjectBegin:
          stack.push(copy(gs));
          if (a[0] && a[0].length === 6) gs.ctm = mulM(gs.ctm, a[0]);
          if (a[1] && a[1].length === 4) gs.clip = boxCut(gs.clip, boxM(gs.ctm, a[1][0], a[1][1], a[1][2], a[1][3]));
          break;
        case OPS.paintFormXObjectEnd: if (stack.length) gs = stack.pop(); break;
        case OPS.beginGroup:
          stack.push(copy(gs));
          gs.group++;
          break;
        case OPS.endGroup: if (stack.length) gs = stack.pop(); break;
        case OPS.setGState:
          (a[0] || []).forEach(function (kv) {
            if (!kv) return;
            if (kv[0] === 'ca') gs.ca = kv[1];
            else if (kv[0] === 'BM') gs.normal = !kv[1] || kv[1] === 'source-over' || kv[1] === 'Normal';
            else if (kv[0] === 'SMask') gs.smask = !!kv[1];
            else if (kv[0] === 'Font' && kv[1] && typeof kv[1][1] === 'number') gs.fs = kv[1][1];
          });
          break;
        case OPS.constructPath:
          var mm = a[2];
          lastPath = mm && mm.length === 4 && isFinite(mm[0]) ? boxM(gs.ctm, mm[0], mm[2], mm[1], mm[3]) : null;
          lastIsBox = !!lastPath && pathIsBox(a[0], a[1], mm, OPS);
          break;
        case OPS.clip:
        case OPS.eoClip:
          if (lastPath) gs.clip = boxCut(gs.clip, lastPath);
          break;
        case OPS.fill:
        case OPS.eoFill:
        case OPS.fillStroke:
        case OPS.eoFillStroke:
        case OPS.closeFillStroke:
        case OPS.closeEOFillStroke:
          if (lastPath && lastIsBox && gs.ca >= 1 && gs.normal && !gs.smask && !gs.group) {
            var fb = boxCut(lastPath, gs.clip);
            if (boxArea(fb) > 0) fills.push({ box: fb });
          }
          break;
        case OPS.paintImageXObject:
          // the unit square under the CTM; only outside transparency
          if (gs.ca >= 1 && gs.normal && !gs.smask && !gs.group && typeof a[0] === 'string') {
            var ib = boxCut(boxM(gs.ctm, 0, 0, 1, 1), gs.clip);
            var det = gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2];
            if (boxArea(ib) > 0 && det) {
              var c = gs.ctm;
              var inv = [c[3] / det, -c[1] / det, -c[2] / det, c[0] / det,
                (c[2] * c[5] - c[3] * c[4]) / det, (c[1] * c[4] - c[0] * c[5]) / det];
              fills.push({ box: ib, img: a[0], inv: inv });
            }
          }
          break;
        case OPS.beginText: tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case OPS.setFont: if (typeof a[1] === 'number') gs.fs = a[1]; break;
        case OPS.setCharSpacing: gs.cs = +a[0] || 0; break;
        case OPS.setWordSpacing: gs.ws = +a[0] || 0; break;
        case OPS.setHScale: gs.hs = (+a[0] || 100) / 100; break;
        case OPS.setLeading: gs.lead = +a[0] || 0; break;
        case OPS.setTextRise: gs.rise = +a[0] || 0; break;
        case OPS.setTextRenderingMode: gs.mode = +a[0] || 0; break;
        case OPS.setTextMatrix: tm = a.slice(0, 6); tlm = tm.slice(); break;
        case OPS.moveText: moveText(+a[0] || 0, +a[1] || 0); break;
        case OPS.setLeadingMoveText: gs.lead = -(+a[1] || 0); moveText(+a[0] || 0, +a[1] || 0); break;
        case OPS.nextLine: moveText(0, -gs.lead); break;
        case OPS.showText:
        case OPS.showSpacedText: show(a[0]); break;
        case OPS.nextLineShowText: moveText(0, -gs.lead); show(a[0]); break;
        case OPS.nextLineSetSpacingShowText:
          gs.ws = +a[0] || 0; gs.cs = +a[1] || 0; moveText(0, -gs.lead); show(a[2]); break;
        default: break;
      }
    }
    // Covered: a box or an opaque image painted AFTER the run that hides
    // (nearly) all of it. An image only covers where its own pixels are
    // opaque (a logo with a transparent ground covers nothing): its alpha
    // is sampled at five points of the run, when the caller can read it.
    var opaqueAt = function (f, r) {
      if (!f.img) return true;
      if (r.ocr) return false;
      if (typeof imageAlpha !== 'function' || !f.inv) return false;
      var b = r.box, w = b[2] - b[0], h = b[3] - b[1];
      var pts = [[0.5, 0.5], [0.1, 0.2], [0.9, 0.2], [0.1, 0.8], [0.9, 0.8]];
      for (var q = 0; q < pts.length; q++) {
        var uv = applyM(f.inv, b[0] + w * pts[q][0], b[1] + h * pts[q][1]);
        var al = imageAlpha(f.img, uv[0], uv[1]);
        if (!(al >= 250)) return false;
      }
      return true;
    };
    runs.forEach(function (r) {
      if (r.hidden) return;
      var area = boxArea(r.box);
      if (!(area > 0)) return;
      for (var k = r.at; k < fills.length; k++) {
        if (boxArea(boxCut(r.box, fills[k].box)) >= area * HIDE_COVER_SHARE && opaqueAt(fills[k], r)) {
          r.hidden = true;
          r.why = (fills[k].img ? 'image ' : 'fill ') + fills[k].box.map(Math.round).join(',');
          return;
        }
      }
    });
    runs.forEach(function (r) { delete r.at; });
    return runs;
  }

  /** Does a text item say what a run says (its first glyphs)? */
  function sameText(itemStr, runText) {
    var a = String(itemStr || '').replace(/\s+/g, ''), b = String(runText || '').replace(/\s+/g, '');
    if (!a || !b) return true;                 // no letters to compare: position decides
    return b.indexOf(a.slice(0, 6)) >= 0 || a.indexOf(b.slice(0, 6)) >= 0;
  }

  /**
   * Drop the text items that only hidden runs account for. An item is
   * matched to the runs whose baseline segment its start lies on and that
   * say the same thing; an item no run accounts for, or that any visible
   * run accounts for, is kept.
   */
  function dropHiddenItems(items, runs) {
    if (!runs || !runs.length || !runs.some(function (r) { return r.hidden; })) return items;
    return items.filter(function (it) {
      if (!it || !it.transform || typeof it.str !== 'string') return true;
      var x = it.transform[4], y = it.transform[5];
      var seen = false;
      for (var i = 0; i < runs.length; i++) {
        var r = runs[i];
        var dx = r.ex - r.sx, dy = r.ey - r.sy, len2 = dx * dx + dy * dy;
        var t = len2 > 0 ? ((x - r.sx) * dx + (y - r.sy) * dy) / len2 : 0;
        if (t < -0.05 || t > 1.05) {
          if (len2 > 0 || Math.abs(x - r.sx) > 1 || Math.abs(y - r.sy) > 1) continue;
        }
        var px = r.sx + Math.max(0, Math.min(1, t)) * dx, py = r.sy + Math.max(0, Math.min(1, t)) * dy;
        if ((px - x) * (px - x) + (py - y) * (py - y) > 2.25) continue;
        // ...and says the same thing: a hidden run can lie exactly on a
        // visible line (socks p6: the clipped glossary's "SSSK (DOUBLE
        // DECREASE)" starts on the point where "chart for your size" does)
        if (!sameText(it.str, r.text)) continue;
        if (!r.hidden) return true;
        seen = true;
      }
      return !seen;
    });
  }

  /* When to read the operator list. A page placed twice prints the same
   * runs again at a constant offset; covered or clipped text lies on top
   * of other text (pdf.js reports both on one baseline). Either is cheap to
   * see in the text content. */
  var OVERLAY_MIN_TWINS = 3;
  var OVERLAY_MIN_CHARS = 10;
  var OVERLAY_OCR_WORDS = 0.8;

  function overlaySuspect(items) {
    var ink = [];
    (items || []).forEach(function (it) {
      if (!it || typeof it.str !== 'string' || !it.transform) return;
      var s = it.str.replace(/\s+/g, ' ').trim();
      if (s.length >= 1) ink.push({ s: s, x: it.transform[4], y: it.transform[5], w: it.width || 0 });
    });
    // (a) several long runs, each printed exactly twice, the second copy at
    //     the same x and the same vertical offset as the others' (a list
    //     repeating "sc in next st" down the page is not a second layer)
    var byText = Object.create(null), offsets = Object.create(null), twins = 0;
    ink.forEach(function (r) {
      if (r.s.length < OVERLAY_MIN_CHARS) return;
      (byText[r.s] = byText[r.s] || []).push(r);
    });
    Object.keys(byText).forEach(function (s) {
      var two = byText[s];
      if (two.length !== 2) return;
      var dy = Math.round(two[0].y - two[1].y);
      if (Math.abs(two[0].x - two[1].x) > 1 || Math.abs(dy) <= Y_TOLERANCE) return;
      offsets[dy] = (offsets[dy] || 0) + 1;
      if (offsets[dy] > twins) twins = offsets[dy];
    });
    if (twins >= OVERLAY_MIN_TWINS) return true;
    // (b) runs lying on other runs of the same baseline: two layers. Not
    //     on an OCR layer, where the words of a tilted scan overlap all the
    //     time (and reading the operator list would decode the scan): OCR
    //     hands back one word per run.
    var words = 0;
    ink.forEach(function (r) { if (!/\s/.test(r.s)) words++; });
    if (ink.length >= 40 && words > ink.length * OVERLAY_OCR_WORDS) return false;
    var lying = 0;
    for (var i = 0; i < ink.length; i++) {
      var a = ink[i];
      if (!(a.w > 0) || !/\S/.test(a.s)) continue;
      for (var k = i + 1; k < ink.length; k++) {
        var b = ink[k];
        if (!(b.w > 0) || Math.abs(a.y - b.y) > Y_TOLERANCE || a.s === b.s) continue;
        var over = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        if (over > Math.min(a.w, b.w) * 0.6 && over > 2) { lying++; break; }
      }
      if (lying >= OVERLAY_MIN_TWINS) return true;
    }
    return false;
  }

  /* Text placed on one page and shown on another (p6 / p9 of the socks
   * book): several long lines that two pages, and only those two, share. */
  var CROSS_MIN_LINES = 3;
  var CROSS_MIN_CHARS = 20;

  function crossPageSuspects(pages) {
    var where = Object.create(null);
    pages.forEach(function (p, pi) {
      var seen = Object.create(null);
      // the page's text runs, not its lines: how the runs are joined into
      // lines depends on the very columns the hidden text upsets
      (p.keys || p.lines.map(function (l) { return l.text; })).forEach(function (t) {
        var k = String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (k.length < CROSS_MIN_CHARS || seen[k]) return;
        seen[k] = true;
        (where[k] = where[k] || []).push(pi);
      });
    });
    var pair = Object.create(null);
    Object.keys(where).forEach(function (k) {
      var w = where[k];
      if (w.length !== 2) return;
      var key = w[0] + ':' + w[1];
      pair[key] = (pair[key] || 0) + 1;
    });
    var out = {};
    Object.keys(pair).forEach(function (key) {
      if (pair[key] < CROSS_MIN_LINES) return;
      key.split(':').forEach(function (pi) { out[pi] = true; });
    });
    return Object.keys(out).map(Number);
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
  function findGaps(rows, x0, x1, minLines) {
    var width = x1 - x0;
    if (!(width > 0) || rows.length < (minLines || MIN_LINES_FOR_COLUMNS)) return [];

    var buckets = Math.ceil(width) + 1;
    if (buckets < MIN_GAP_WIDTH * 2) return [];
    var crossing = new Array(buckets);
    var b;
    for (b = 0; b < buckets; b++) crossing[b] = 0;

    var seen = new Array(buckets);
    var lastEnd = {}, firstStart = {};    // by bucket, for printedWidth below
    for (var r = 0; r < rows.length; r++) {
      for (b = 0; b < buckets; b++) seen[b] = false;
      var items = rows[r].items;
      for (var i = 0; i < items.length; i++) {
        var from = Math.max(0, Math.floor(items[i].x - x0));
        var to = Math.min(buckets - 1, Math.ceil(items[i].end - x0));
        for (b = from; b <= to; b++) seen[b] = true;
        if (!(lastEnd[to] >= items[i].end)) lastEnd[to] = items[i].end;
        if (!(firstStart[from] <= items[i].x)) firstStart[from] = items[i].x;
      }
      for (b = 0; b < buckets; b++) if (seen[b]) crossing[b]++;
    }

    var allowed = Math.floor(rows.length * MAX_CROSSING);
    var lo = x0 + width * BAND_LO;
    var hi = x0 + width * BAND_HI;
    // The buckets round every item outwards to whole points, so a clear run
    // is one to three points narrower than the gutter as printed. A run that
    // just misses is measured on the ink either side of it: a column set at
    // x 402 arrives at 401.99, and a 12 pt gutter between two of the four
    // columns of knit-patons-cabled-yoke p2 counted 9 buckets and was no
    // gutter. Only the decision changes, never the split position.
    var printedWidth = function (run) {
      var left = lastEnd[Math.round(run.start - x0) - 1], right = firstStart[Math.round(run.end - x0)];
      return left === undefined || right === undefined ? 0 : right - left;
    };
    var wide = function (run) {
      var w = run.end - run.start;
      return w >= MIN_GAP_WIDTH || (w >= MIN_GAP_WIDTH - 2 && printedWidth(run) > MIN_GAP_WIDTH + 1);
    };
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
    // A2 - in a band (a block of a few rows, measured on its own ink) a
    //     band nothing bridges may sit well off the middle: a narrow title
    //     column beside a wide intro (knit-interweave-8-socks p4 "time
    //     traveler"), a two-line FINISHING column beside CUFF (p6).
    if ((minLines || MIN_LINES_FOR_COLUMNS) < MIN_LINES_FOR_COLUMNS) {
      strict.slice().sort(widest).forEach(function (run) {
        if (run.start <= x0 + 1 || run.end >= x1 - 1) return;     // a margin
        if (run.mid >= x0 + width * BAND_EDGE && run.mid <= x1 - width * BAND_EDGE) push(run.mid, false);
      });
    }
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
  var TITLE_CENTRED = 0.02;   // a centred title line is this share of the ink width off centre
  var TITLE_SHORT = 0.6;      // ...and at most this share of it wide

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
    // ...and a heading over a table that opens the region is the table's
    // own ("MATERIALS" over the yarn table of knit-patons-cabled-yoke p1,
    // whose size cells otherwise fell either side of the abbreviation
    // columns' gutter, and lost every size but the first)
    var heads = function (k) {
      return k + 1 < n && bridge[k + 1] && cellCount(rows[k]) <= 1;
    };
    k = 0;
    while (k < n && (inRun(k) || heads(k))) k++;
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
    // A title block centred over the page: its short lines between the
    // full-width ones do not reach the gutter, and fell into the column
    // under them (knit-sandnes-raglan-child p2: "children" and the
    // "INSTRUCTION: ..." credit were read after the whole first column).
    // Rows at the head of the region that bridge the gutter or stand
    // centred on the region's ink, one run each, are read whole.
    if (n > 1 && bridge[0]) {
      var lo = Infinity, hi = -Infinity;
      rows.forEach(function (row) {
        row.items.forEach(function (it) {
          if (!it.str.replace(/\s/g, '')) return;
          if (it.x < lo) lo = it.x;
          if (it.end > hi) hi = it.end;
        });
      });
      var centre = (lo + hi) / 2;
      var centred = function (row) {
        var ink = row.items.filter(function (it) { return it.str.replace(/\s/g, ''); });
        if (!ink.length || cellCount(row) !== 1) return false;
        var a = ink[0].x, b = ink[ink.length - 1].end;
        // a short line: two column heads side by side are centred too
        if (b - a > (hi - lo) * TITLE_SHORT) return false;
        return Math.abs((a + b) / 2 - centre) <= (hi - lo) * TITLE_CENTRED;
      };
      var head = 0;
      while (head < n && (bridge[head] || centred(rows[head]))) head++;
      if (head >= 2) {
        for (i = 0; i < head; i++) whole[i] = true;
        any = true;
      }
    }
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

  /* Columns are decided per BAND of rows, not per page. A magazine page
   * stacks blocks with different column grids: three columns of pattern
   * over a two-column sidebar (knit-interweave-8-socks p20), a three-column
   * spinning table over two columns of rounds (knit-interweave-lace p31), a
   * full-width "Notes" block over two columns (socks p15). One gutter for
   * the whole region either does not exist (the blocks bridge each other's
   * gutters, so lines came out mixed column by column) or is wrong for one
   * of the blocks. A band is a run of rows with no full-width blank between
   * them taller than BAND_CUT_GAP body lines; the bands are read top to
   * bottom, each with its own columns, but only when they DISAGREE: one
   * band bridges the region's gutter on a good share of its rows, or the
   * region has no gutter and a band has one. Bands that agree keep the
   * region's gutter, so a page of two columns still flows down its gutter
   * across a blank that both columns happen to share. */
  var BAND_CUT_GAP = 2.2;     // a blank this many body heights tall separates bands
  var BAND_CUT_INK = 1.6;     // ...and this many heights of the line below it
  var BAND_MIN_LINES = 5;     // a band this short may still hold columns
  var BAND_SIDE_LINES = 2;    // ...and a side this short across a clean gutter
  var BAND_EDGE = 0.1;        // ...which may sit anywhere but this close to an edge
  var BAND_MIN_CROSS = 2;     // a band disagrees when this many of its rows...
  var BAND_CROSS_SHARE = 0.3; // ...and this share of them bridge the gutter

  function horizontalBands(rows) {
    if (!rows.length) return [];
    var bodyH = dominantHeight(rows) || 10;
    var out = [[rows[0]]];
    for (var i = 1; i < rows.length; i++) {
      var gap = rows[i].order - rows[i - 1].order;
      var h = rowInkHeight(rows[i]) || bodyH;
      if (gap > bodyH * BAND_CUT_GAP && gap > h * BAND_CUT_INK) out.push([rows[i]]);
      else out[out.length - 1].push(rows[i]);
    }
    return out;
  }

  var GRID_SINGLES = 0.5;     // a region whose words are mostly one glyph is a chart

  function isSymbolGrid(rows) {
    var words = 0, singles = 0;
    rows.forEach(function (row) {
      row.items.forEach(function (it) {
        it.str.split(/\s+/).forEach(function (w) {
          if (!w) return;
          words++;
          if (w.length === 1) singles++;
        });
      });
    });
    return words > 0 && singles > words * GRID_SINGLES;
  }

  /* A band is measured on its own ink: a block of two columns beside an
   * empty photo area (crochet-bernat-basketweave p1's abbreviations box)
   * has its gutter far off the middle of the page, where findGaps never
   * looks, but in the middle of the block. */
  function bandSpan(band, x0, x1) {
    var lo = Infinity, hi = -Infinity;
    band.forEach(function (row) {
      row.items.forEach(function (it) {
        if (!it.str.replace(/\s/g, '')) return;
        if (it.x < lo) lo = it.x;
        if (it.end > hi) hi = it.end;
      });
    });
    if (!isFinite(lo) || !(hi > lo)) return { lo: x0, hi: x1 };
    return { lo: Math.max(x0, lo - 1), hi: Math.min(x1, hi + 1) };
  }

  /* A band of table rows (most rows three or more short cells, or mostly
   * figures) never makes its band disagree with the region, and in a page
   * read band by band it is read as a region of its own would be, with the
   * usual line minimum: a size chart read row by row stays row by row
   * (sew-peppermint-bronte-bathers p5, knit-bernat-topdown-pullover "To fit
   * chest | Finished chest"), and the craft parsers that zip column-split
   * keys back (see tableEnds) see what they always saw. */
  var TABLE_FIGURES = 0.6;

  function isTableBand(band) {
    var cells = 0, ink = 0;
    for (var t = 0; t < band.length; t++) {
      var n = cellCount(band[t]);
      if (n) ink++;
      // cells of a word or three: three prose columns side by side are
      // three "cells" of whole lines (see isTableRow)
      var nw = rowText(band[t]).split(/\s+/).filter(Boolean).length;
      if (n >= TABLE_MIN_CELLS && nw <= n * TABLE_CELL_WORDS) cells++;
    }
    if (ink > 0 && cells * 2 > ink) return true;
    // ...or a grid of figures: a size chart whose cells are set too tight
    // to count (bronte p5: "9X 142 56 126 50")
    var words = 0, figures = 0;
    band.forEach(function (row) {
      row.items.forEach(function (it) {
        it.str.split(/\s+/).forEach(function (w) {
          if (!w) return;
          words++;
          if (/\d/.test(w) && !/[a-z]{3}/i.test(w)) figures++;
        });
      });
    });
    return words > 0 && figures > words * TABLE_FIGURES;
  }

  var PAIRED_SHARE = 0.7;   // rows with ink on both sides of the gutter
  var PAIRED_WORDS = 4;       // ...each side a cell of at most this many words (median)
  var PAIRED_LABEL = 3;       // ...or the left side labels of at most this many

  function isPairedTable(rows, mid) {
    var both = 0, lw = [], rw = [];
    var text = function (items) { return items.map(function (it) { return it.str; }).join(' '); };
    rows.forEach(function (row) {
      var parts = splitRow(row, mid);
      var lt = text(parts.left), rt = text(parts.right);
      var l = lt.split(/\s+/).filter(Boolean).length, r = rt.split(/\s+/).filter(Boolean).length;
      if (!l || !r) return;
      both++;
      lw.push(l);
      rw.push(r);
    });
    if (both < rows.length * PAIRED_SHARE) return false;
    var med = function (a) { a.sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
    // short cells both sides, or a column of labels ("Colour used | A White
    // 1001, B Cloud Blue 1019,", crochet-stylecraft-hood p2) beside values
    var l = med(lw), r = med(rw);
    return l <= PAIRED_LABEL || (l <= PAIRED_WORDS && r <= PAIRED_WORDS);
  }

  function bandsDisagree(bands, res, x0, x1) {
    for (var b = 0; b < bands.length; b++) {
      var band = bands[b];
      if (band.length < BAND_MIN_LINES) continue;
      // A table the gutter runs through keeps the split it always had: the
      // craft parsers zip those blocks back themselves (see tableEnds).
      if (isTableBand(band)) continue;
      var sp = bandSpan(band, x0, x1);
      if (res.split) {
        var n = 0, cross = [];
        for (var r = 0; r < band.length; r++) {
          cross.push(bridgesGutter(band[r], res.mid, 0));
          if (cross[r]) n++;
        }
        if (n < BAND_MIN_CROSS) continue;
        // Only rows that bridge the gutter IN THE MIDDLE of the band count:
        // lines at its top or bottom edge are a full-width note or a header
        // that fullWidthBands reads in place (the "X = Cross Stitch" legend
        // and the "Stitches Length" header of the xs-tinymodernist-halloween
        // key). A good share of them, or a few plus a gutter of the band's
        // own somewhere else (lace p31: the spinning table's long lines poke
        // across the gutter of the rounds below it), is a disagreement.
        var lo = 0, hi = band.length - 1;
        while (lo <= hi && cross[lo]) lo++;
        while (hi >= lo && cross[hi]) hi--;
        var inner = 0;
        for (r = lo; r <= hi; r++) if (cross[r]) inner++;
        if (inner < BAND_MIN_CROSS) continue;
        if (inner >= band.length * BAND_CROSS_SHARE) return true;
        var own = columnizeAt(band, sp.lo, sp.hi, { left: 1 }, BAND_MIN_LINES);
        if (own.split && Math.abs(own.mid - res.mid) > MIN_GAP_WIDTH) return true;
      } else if (columnizeAt(band, sp.lo, sp.hi, { left: 1 }, BAND_MIN_LINES).split) {
        return true;
      }
    }
    return false;
  }

  /* A column that runs on across a band cut. A blank in the longest column
   * of a block cuts a band when the columns beside it have already ended
   * above it, so nothing on the right fills the blank: the sleeve column of
   * knit-patons-boxy-cable p4 goes on, past a blank, into FINISHING and
   * the neckband pick-up, while the shorter column beside it (the neckband
   * ribbing, the sewing up) stopped three lines higher. Read band by band,
   * the short column landed between the two halves of the long one. When
   * the column that reaches the band's foot is followed only by columns
   * that stop at least RUN_ON_SHORT lines higher, the rows at the head of
   * the next band that sit inside that column, and clear of every other,
   * are its run-on. A sidebar under columns that end level is still read
   * after them. */
  var RUN_ON_SHORT = 1.5;     // body heights the columns to its right stop short
  var RUN_ON_SLACK = 0.5;     // body heights a run-on row may overhang its column
  var RUN_ON_MIN_ROWS = 2;

  function inkSpan(rows) {
    var lo = Infinity, hi = -Infinity, last = -Infinity;
    rows.forEach(function (row) {
      row.items.forEach(function (it) {
        if (!it.str.replace(/\s/g, '')) return;
        if (it.x < lo) lo = it.x;
        if (it.end > hi) hi = it.end;
      });
      if (row.order > last) last = row.order;
    });
    return { lo: lo, hi: hi, last: last };
  }

  function runOnColumn(cols, band) {
    if (cols.length < 2 || band.length < RUN_ON_MIN_ROWS) return null;
    var bodyH = dominantHeight(band) || 10;
    var ext = cols.map(inkSpan);
    var bottom = -Infinity;
    ext.forEach(function (e) { if (e.last > bottom) bottom = e.last; });
    for (var k = 0; k < ext.length - 1; k++) {
      if (ext[k].last < bottom) continue;
      var short = true;
      for (var j = k + 1; j < ext.length; j++) {
        if (ext[j].last > bottom - bodyH * RUN_ON_SHORT) short = false;
      }
      if (!short) return null;
      var slack = bodyH * RUN_ON_SLACK, n = 0, e;
      for (; n < band.length; n++) {
        e = inkSpan([band[n]]);
        if (!(e.lo >= ext[k].lo - slack && e.hi <= ext[k].hi + slack)) break;
      }
      if (n < RUN_ON_MIN_ROWS) return null;
      // whatever follows in the band (a footer) is clear of the column: a
      // paragraph that only starts inside it and then runs wider beside a
      // figure is a block of its own (other-embroidery-stitchedstories-guide)
      for (var r = n; r < band.length; r++) {
        e = inkSpan([band[r]]);
        if (e.lo < ext[k].hi && e.hi > ext[k].lo) return null;
      }
      return { k: k, n: n };
    }
    return null;
  }

  function columnize(rows, x0, x1, budget, minLines) {
    minLines = minLines || MIN_LINES_FOR_COLUMNS;
    if (budget.left <= 0 || rows.length < minLines) {
      return { columns: [rows], split: false };
    }
    var trial = { left: budget.left };
    var res = columnizeAt(rows, x0, x1, trial, minLines);
    // A symbol chart is a grid, not a page of blocks: its blank rows are
    // not band breaks (xs-pokemon: a chart cut into bands loses its rows).
    var bands = isSymbolGrid(rows) ? [rows] : horizontalBands(rows);
    if (bands.length >= 2 && bandsDisagree(bands, res, x0, x1)) {
      var cols = [], split = false, prev = null;
      bands.forEach(function (band) {
        // a column of the band above that runs on below the cut takes the
        // rows that sit under it before the columns to its right are read
        var on = prev && runOnColumn(prev.columns, band);
        if (on) {
          var ci = prev.base + on.k;
          var merged = cols[ci].concat(band.slice(0, on.n));
          merged.group = cols[ci].group;
          cols[ci] = prev.columns[on.k] = merged;
          band = band.slice(on.n);
          if (!band.length) return;
        }
        prev = null;
        // a table band is read as a region of its own would be, with the
        // usual line minimum: a short size table stays row by row
        // (knit-bernat-topdown-pullover "To fit chest | Finished chest")
        if (isTableBand(band)) {
          var tsub = columnize(band, x0, x1, { left: budget.left });
          cols = cols.concat(tsub.columns);
          if (tsub.split) split = true;
          return;
        }
        var span = bandSpan(band, x0, x1);
        var sub = columnize(band, span.lo, span.hi, { left: budget.left }, BAND_MIN_LINES);
        if (sub.columns.length >= 2) prev = { base: cols.length, columns: sub.columns.slice() };
        cols = cols.concat(sub.columns);
        if (sub.split) split = true;
      });
      return { columns: cols, split: split };
    }
    budget.left = trial.left;
    return res;
  }

  function columnizeAt(rows, x0, x1, budget, minLines) {
    if (budget.left <= 0 || rows.length < minLines) {
      return { columns: [rows], split: false };
    }
    var gaps = preferRecordGaps(rows, findGaps(rows, x0, x1, minLines));
    // Only a real two-column page, please: both sides need actual content.
    var share = Math.max(MIN_COLUMN_LINES, Math.ceil(rows.length * MIN_COLUMN_SHARE));
    var band = minLines < MIN_LINES_FOR_COLUMNS;

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
      var need = band && !noisy ? BAND_SIDE_LINES : share;
      if (left.length < need || right.length < need) continue;
      var wLeft = extentOf(left), wRight = extentOf(right);
      if (wLeft < MIN_COLUMN_WIDTH || wRight < MIN_COLUMN_WIDTH) continue;
      if (noisy && (x1 - x0) > 0 &&
          (wLeft < (x1 - x0) * NOISY_COLUMN_SHARE || wRight < (x1 - x0) * NOISY_COLUMN_SHARE)) {
        continue;                  // a table's cell wall, not a gutter
      }
      // In a band (few rows), two sides paired line for line in short cells
      // are a two-column table ("Single Crochet | Double Crochet", bee p2's
      // US / UK terms; the Yarnspirations abbreviation box "Alt = Alternate |
      // P = Purl", which the glossary readers take two to a line), read row
      // by row as before, not as a pair of columns.
      if (minLines < MIN_LINES_FOR_COLUMNS && isPairedTable(rows, mid)) continue;

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
          if (bl.length) cols = cols.concat(columnize(bl, x0, mid, budget, minLines).columns.map(tag('L')));
          if (br.length) cols = cols.concat(columnize(br, mid, x1, budget, minLines).columns.map(tag('R')));
        });
        return { columns: cols, split: true, mid: mid };
      }
      var out = [];
      var sub = columnize(left, x0, mid, budget, minLines);
      out = out.concat(sub.columns);
      sub = columnize(right, mid, x1, budget, minLines);
      out = out.concat(sub.columns);
      return { columns: out, split: true, mid: mid };
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

  /* A two-page spread is two pages. A landscape sheet with nothing crossing
   * its centre line is read left page, then right page, however few lines
   * it holds: knit-sandnes-0216 prints one model's info box on each page of
   * a spread ("Booklet / 5½ / 0216EN / 15 | 10 / Model 1"), and with fewer
   * rows than a page of columns needs, the two boxes came out zipped line
   * by line ("Booklet Booklet / 5 3 / 0216EN 0216EN"). */
  var SPREAD_ASPECT = 1.35;      // two portrait pages side by side (letter landscape is 1.29)
  var SPREAD_CLEAR = 2;           // points either side of the centre line

  function spreadHalves(rows, pageWidth, pageHeight) {
    if (rows.sideways || !(pageWidth > pageHeight * SPREAD_ASPECT) || isSymbolGrid(rows)) return null;
    var mid = pageWidth / 2, left = [], right = [];
    for (var r = 0; r < rows.length; r++) {
      var l = [], rt = [];
      for (var i = 0; i < rows[r].items.length; i++) {
        var it = rows[r].items[i];
        if (!it.str.replace(/\s/g, '')) {
          ((it.x + it.end) / 2 < mid ? l : rt).push(it);
          continue;
        }
        if (it.x < mid + SPREAD_CLEAR && it.end > mid - SPREAD_CLEAR) return null;
        (it.end <= mid ? l : rt).push(it);
      }
      if (l.length) left.push({ y: rows[r].y, order: rows[r].order, items: l });
      if (rt.length) right.push({ y: rows[r].y, order: rows[r].order, items: rt });
    }
    var ink = function (side) {
      return side.some(function (row) { return row.items.some(function (it) { return it.str.replace(/\s/g, ''); }); });
    };
    if (!ink(left) || !ink(right)) return null;
    var cols = columnize(left, 0, mid, { left: MAX_COLUMNS - 1 }).columns
      .concat(columnize(right, mid, pageWidth, { left: MAX_COLUMNS - 1 }).columns);
    return { columns: cols, split: true };
  }

  /* An advert at the head of a column. Reading order puts whatever starts
   * a column right after the end of the column before it, so a magazine
   * ad box set above the third column landed inside a row that runs on
   * from the second column to the third (knit-interweave-8-socks p5:
   * "Row 1 (RS) Knit to wrapped st, ... insert right needle into wrap" /
   * "K NITS / Interweave Knits IS A MUST HAVE ..." / "then kwise into
   * wrapped st ..."). Two signals together, neither a word list:
   *  - the block is set in its own type: no glyph on any of its lines is
   *    near the page's body size (the ad's 4.5 pt small print and 33 pt
   *    logo), and
   *  - it interrupts a sentence: the line before it, the last of the
   *    previous column, does not end one, and the line after it, its own
   *    column's next line, starts in lower case.
   * The block is not dropped (it is real, visible text) but moved after the
   * page's text, out of the row it split. */
  var AD_MAX_LINES = 6;
  var AD_MIN_WORDS = 3;         // words in its small print
  var AD_BODY_LO = 0.75;        // a line whose glyphs are all under this share
  var AD_BODY_HI = 1.4;         // ...or over this share of the body size is off-body

  function offBody(row, bodyH) {
    var any = false;
    for (var i = 0; i < row.items.length; i++) {
      var it = row.items[i];
      if (!it.str.replace(/\s/g, '')) continue;
      any = true;
      if (it.h >= bodyH * AD_BODY_LO && it.h <= bodyH * AD_BODY_HI) return false;
    }
    return any;
  }

  function moveInterruptions(lines, bodyH) {
    if (!(bodyH > 0) || lines.length < 3) return lines;
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].col === lines[i - 1].col || !lines[i].row) continue;      // a column's first line
      var j = i;
      while (j < lines.length && j - i < AD_MAX_LINES && lines[j].col === lines[i].col && offBody(lines[j].row, bodyH)) j++;
      if (j === i || j >= lines.length || lines[j].col !== lines[i].col) continue;
      // an ad carries small print; a block of big type alone is a heading
      // in words (a chart's grid of symbols or figure labels is no ad)
      var fine = 0;
      for (var q = i; q < j; q++) {
        lines[q].row.items.forEach(function (it) {
          if (it.h < bodyH * AD_BODY_LO) fine += (it.str.match(/[A-Za-z]{3,}/g) || []).length;
        });
      }
      if (fine < AD_MIN_WORDS) continue;
      if (/[.:;!?)\]"]\s*$/.test(lines[i - 1].text) || !/^[a-z]/.test(lines[j].text)) continue;
      var moved = lines.splice(i, j - i);
      lines = lines.concat(moved);
      break;
    }
    return lines;
  }

  /* A bare number in the margin is a page number, unless it heads a run of
   * row numbers down the side of a chart: the next number on, a line or so
   * away in its column, counts on from it (the Albus Argyle leg chart's top
   * label "45" sits in the top 8% of knit-interweave-8-socks p30, over 43,
   * 41, 39 ...). */
  function inNumberRun(rows, ri, text) {
    var n = parseInt(text, 10), h = rowInkHeight(rows[ri]) || 10;
    for (var d = -1; d <= 1; d += 2) {
      var o = rows[ri + d];
      if (!o || Math.abs(o.order - rows[ri].order) > h * 4) continue;
      var t = rowText(o);
      if (BARE_NUMBER_RE.test(t) && t !== text && Math.abs(parseInt(t, 10) - n) <= 2) return true;
    }
    return false;
  }

  /* A side heading: capitals only, three letters at least ("NOTIONS", "FABRIC
   * REQUIREMENTS"). */
  var SIDE_HEADING_RE = /^(?=(?:[^A-Za-z]*[A-Z]){3})[A-Z0-9 &'’\/:,.()-]+$/;

  /* A spaced-out display heading is not a row of photo letters: "T O
   * C R O C H E T" over the cover blurb of crochet-stylecraft-guide p1 (once
   * restoreCase gives it its capitals back). It spells a word (see
   * spacedRunIsWord), uses five different letters or more (a diagram's
   * "G E E G G E" uses two), is set near body size (a logo tagline is
   * not: sew-swoon-mabel-bag) and no bigger than a heading (the 49 pt
   * "P A T T E R N R" across a pattern-piece sheet of sew-sundress-pattern
   * is a watermark). */
  var SPACED_HEADING_LETTERS = 5;
  var SPACED_HEADING_MAX = 2.5;   // body heights: bigger is a watermark

  function isSpacedHeading(row, text, bodyH) {
    if (!/^[A-Z](?: [A-Z]){5,}$/.test(text) || !spacedRunIsWord(text)) return false;
    var seen = {}, n = 0;
    text.replace(/ /g, '').split('').forEach(function (c) { if (!seen[c]) { seen[c] = true; n++; } });
    if (n < SPACED_HEADING_LETTERS) return false;
    var h = rowInkHeight(row);
    return !(bodyH > 0) || (h >= bodyH * TRACKED_MIN_SIZE && h <= bodyH * SPACED_HEADING_MAX);
  }

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

    var sideways = !!rows.sideways;
    var span = sideways ? rows.span : { lo: 0, hi: pageWidth > 0 ? pageWidth : 612 };
    // A landscape sheet has room for one more column than a portrait one:
    // knit-patons-cabled-yoke p1 sets a three-column abbreviation box
    // beside two columns of rows, and with four the rows never split.
    var budget = { left: Math.max(MAX_COLUMNS, Math.floor((span.hi - span.lo) / COLUMN_PITCH)) - 1 };
    var res = spreadHalves(rows, pageWidth, pageHeight) || columnize(rows, span.lo, span.hi, budget);
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
      var sorted = col.slice().sort(function (a, b) { return a.order - b.order; });
      sorted.forEach(function (row, ri) {
        var text = rowText(row, deglyph);
        // judged without control codes: "I\u001f I" is a row of diagram letters
        if (!text || (isFurniture(text.replace(INVISIBLE_RE, '')) && !isSpacedHeading(row, text, bodyH))) return;
        var at0 = row.y - keyLo;
        var inMargin = at0 >= h * (1 - MARGIN_BAND) || at0 <= h * MARGIN_BAND;
        if (inMargin && BARE_NUMBER_RE.test(text) && !inNumberRun(sorted, ri, text)) return;     // a page number
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
        lines.push({ text: k.text, margin: margin, edge: h > 0 ? Math.min(at, h - at) / h : 1, pos: h > 0 ? at / h : 0.5,
          col: ci, row: k.row });
      });
    });
    lines = moveInterruptions(lines, bodyH);
    // wave K: where each line sits (layout() reads it; readDoc and textOf
    // copy only the text fields, so the text output never sees it)
    lines.forEach(function (l) { l.geo = rowGeo(l.row, l.col); delete l.col; delete l.row; });
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

  /* ...but a pattern row is never furniture. A raglan repeats "2nd row: P2.
   * P2tog. Pat to last" / "4 sts. P2togtbl. P2." near the foot of three of
   * its five pages, at about the same height each time
   * (knit-patons-boyfriend-cable p2-p4), and all three copies were dropped.
   * A line that opens with a row or round label is pattern text, and so is
   * its run-on while the sentence is still open (it starts in lower case or
   * with a count). */
  var ROW_LABEL_RE = /^\s*(?:(?:rows?|rnds?|rounds?)\s*\d+|\d+(?:st|nd|rd|th)\s+(?:rows?|rnds?|rounds?))\b/i;
  var CONTINUED_RE = /^\s*[a-z0-9(]/;
  var SENTENCE_END_RE = /[.!?]["')\]]?\s*$/;

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
      var carry = false;    // the line before was a pattern row kept below
      p.lines.forEach(function (l) {
        if (isFolio(l, p, folio)) return;
        var runOn = carry && CONTINUED_RE.test(l.text);
        carry = false;
        if (isAnywhereFurniture(l, everywhere)) {
          if (!runOn && !ROW_LABEL_RE.test(l.text)) return;
          carry = !SENTENCE_END_RE.test(l.text);
        }
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
    var checked = {};
    var caseState = newCaseState();   // restoreCase, document-wide
    var applied = {};
    var fontsOn = {};
    var ocrPages = [];
    var chain = Promise.resolve();
    var noteFonts = function (p, items) {
      var f = {};
      items.forEach(function (it) { if (it && it.fontName) f[it.fontName] = true; });
      fontsOn[p] = f;
    };

    var makeStep = function (p) {
      return function () {
        if (isCancelled(signal)) throw abortError();
        if (onProgress) {
          try { onProgress(p, total); } catch (e) { /* UI errors are not our problem */ }
        }
        // wave K: OCR lines attached to an image-only page (handle.setPageText)
        var given = typeof opts.pageText === 'function' ? opts.pageText(p) : null;
        if (given) {
          checked[p] = true;
          fontsOn[p] = {};
          ocrPages.push(p);
          pages.push({
            keys: [],
            number: p,
            ocr: true,
            lines: given.map(function (l) {
              return { text: normUnicode(l.text), margin: !!l.margin, edge: l.edge == null ? 1 : l.edge, pos: l.pos == null ? 0.5 : l.pos };
            })
          });
          return null;
        }
        return doc.getPage(p).then(function (page) {
          return visibleItems(page, null, caseState).then(function (vis) {
            var size = pageSize(page);
            var res = pageLines(vis.items, size.width, size.height, page.rotate);
            if (res.split) columnsDetected++;
            checked[p] = vis.checked;
            applied[p] = vis.applied;
            noteFonts(p, vis.items);
            var keys = [];
            vis.items.forEach(function (it) {
              if (it && typeof it.str === 'string' && it.str.length >= CROSS_MIN_CHARS) keys.push(it.str);
            });
            // The garble verdict is taken here, on the RAW line text: the
            // control codes that give a broken subset font away are about
            // to be stripped out by normUnicode.
            res.lines.forEach(function (l) {
              if (rawSample.length < GARBLE_SAMPLE) rawSample += l.text + '\n';
            });
            pages.push({
              keys: keys,
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

    // Text placed on one page and shown on another: re-read both pages
    // with their hidden runs removed (see section 3a).
    var recheck = function () {
      var again = Promise.resolve();
      crossPageSuspects(pages).forEach(function (pi) {
        var pg = pages[pi];
        if (!pg || checked[pg.number]) return;
        again = again.then(function () {
          if (isCancelled(signal)) throw abortError();
          return doc.getPage(pg.number).then(function (page) {
            return visibleItems(page, true, caseState).then(function (vis) {
              checked[pg.number] = true;
              applied[pg.number] = vis.applied;
              var size = pageSize(page);
              var res = pageLines(vis.items, size.width, size.height, page.rotate);
              pg.lines = res.lines.map(function (l) {
                return { text: normUnicode(l.text), margin: l.margin, edge: l.edge, pos: l.pos };
              });
              if (typeof page.cleanup === 'function') page.cleanup();
            });
          });
        });
      });
      return again;
    };

    // A font caught flipping case on a later page: re-read the earlier
    // pages that use it (see restoreCase).
    var recase = function () {
      var again = Promise.resolve();
      pages.forEach(function (pg) {
        var done = applied[pg.number] || {};
        var hit = Object.keys(fontsOn[pg.number] || {}).some(function (f) { return caseState.fonts[f] && !done[f]; });
        if (!hit) return;
        again = again.then(function () {
          if (isCancelled(signal)) throw abortError();
          return doc.getPage(pg.number).then(function (page) {
            return visibleItems(page, checked[pg.number] || null, caseState).then(function (vis) {
              var size = pageSize(page);
              var res = pageLines(vis.items, size.width, size.height, page.rotate);
              pg.lines = res.lines.map(function (l) {
                return { text: normUnicode(l.text), margin: l.margin, edge: l.edge, pos: l.pos };
              });
              if (typeof page.cleanup === 'function') page.cleanup();
            });
          });
        });
      });
      return again;
    };

    return chain.then(recheck).then(recase).then(function () {
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
        ocrNoise: ocrNoise(text),
        // wave K: pages whose text was read from a picture (setPageText):
        // the UI must say "check every row" for them
        ocrPages: ocrPages.slice().sort(function (a, b) { return a - b; })
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
          disableFontFace: true,
          // glyph names for restoreCase
          fontExtraProperties: true
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

  /**
   * imageAlpha(id, u, v) for textVisibility: the alpha (0-255) of the
   * page's decoded image `id` at unit-square point (u, v), or null when it
   * cannot be read (not decoded yet, no canvas). An RGB image is opaque.
   */
  function imageAlphaOf(page) {
    var probe = null;
    return function (id, u, v) {
      var o = null;
      try { o = (id.indexOf('g_') === 0 ? page.commonObjs : page.objs).get(id); } catch (e) { return null; }
      if (!o || !(o.width > 0) || !(o.height > 0)) return null;
      if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
      var px = Math.min(o.width - 1, Math.floor(u * o.width));
      var py = Math.min(o.height - 1, Math.floor((1 - v) * o.height));
      if (o.data && (o.kind === 1 || o.kind === 2)) return 255;
      if (o.data && o.kind === 3) return o.data[(py * o.width + px) * 4 + 3];
      if (!o.bitmap || typeof document === 'undefined') return null;
      try {
        if (!probe) {
          probe = document.createElement('canvas');
          probe.width = 1;
          probe.height = 1;
        }
        var g = probe.getContext('2d');
        g.clearRect(0, 0, 1, 1);
        g.drawImage(o.bitmap, px, py, 1, 1, 0, 0, 1, 1);
        return g.getImageData(0, 0, 1, 1).data[3];
      } catch (e) {
        return null;
      }
    };
  }

  /* ---- Capitals a font hands back in lower case ----------------------- *
   * A subset font may carry a ToUnicode map that gives some capitals the
   * code point of their small letter. knit-patons-cabled-yoke sets every
   * heading, size name and abbreviation in such a Gotham-Bold: "MATERIALS"
   * reads "MaTerIalS", the size L reads "l", "C4B" reads "C4b", "K = Knit"
   * reads "k = Knit" (crochet-stylecraft-guide's "UK TERMS" reads "uk
   * TerMS", knit-interweave-8-socks' "FINISHING" "FiNiSHiNG").
   * pdf.js can only report what the map says, but the font's encoding still
   * names every glyph ("A", "K", "L"). A glyph whose name is one case of a
   * letter that the map turns into the other case is restored to the case
   * of its name. Only the case ever changes, never the letter.
   * The names come with the operator list (and getDocument's
   * fontExtraProperties), which costs an image decode, so a page is only
   * looked at when its text shows the symptom - a word that steps from
   * small letters to capitals twice or more ("MaTerIalS", "boTToM"), not
   * counting an OCR layer's glyphless font, whose noise does that too
   * ("raMAveRTT") - or when it uses a font already caught and its text
   * cannot be restored without the glyphs (see caseByWidth). */
  var CASE_MIN_FLIPS = 2;       // a word with this many small-to-capital steps
  var CASE_LOOKAHEAD = 4;       // glyphs a short text item may sit ahead of the last match
  var CASE_MIN_RUN = 3;         // ...and an item of this many letters anywhere ahead
  var CASE_WORD_RE = /[A-Za-z]{3,}/g;
  var ASCII_LETTER_RE = /^[A-Za-z]$/;
  var UNI_NAME_RE = /^(?:uni|u)[0-9A-F]{4,6}$|\./;   // "uni0041", "a.sc": no letter of their own

  function newCaseState() {
    return { fonts: {}, named: {}, shapes: {}, wide: {} };
  }

  /** An OCR layer's invisible font: pdf.js reports it monospace, ascent 1, no descent. */
  function isGlyphless(style) {
    return !!style && style.fontFamily === 'monospace' && style.ascent >= 0.99 &&
      Math.abs(style.descent || 0) < 0.01;
  }

  function caseSuspect(items, styles, skip) {
    // touching items are glued back into words first: a broken heading
    // comes as one item per change of case ("M|a|T|er|I|al|S")
    var s = '', prev = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string' || !it.transform) continue;
      if ((skip && skip[it.fontName]) || (styles && isGlyphless(styles[it.fontName]))) { prev = null; continue; }
      var t = it.transform;
      var touch = prev && Math.abs(t[5] - prev.y) < 1 && Math.abs(t[4] - prev.end) < 1;
      s += (touch ? '' : ' ') + it.str;
      prev = { y: t[5], end: t[4] + (it.width || 0) };
    }
    var words = s.match(CASE_WORD_RE) || [];
    for (i = 0; i < words.length; i++) {
      var flips = (words[i].match(/[a-z](?=[A-Z])/g) || []).length;
      if (flips >= CASE_MIN_FLIPS) return true;
    }
    return false;
  }

  function glyphName(font, code) {
    var n = font.differences && font.differences[code];
    if (!n && font.defaultEncoding) n = font.defaultEncoding[code];
    return typeof n === 'string' ? n : '';
  }

  /* ...but a name is not a shape. crochet-stylecraft-guide's FrutigerCE-Light
   * charts key puts lowercase drawings at the codes and names of capitals
   * ("adjustable ring" is printed in lower case, and its ToUnicode map is
   * right). What tells them apart is width.
   *  - Capitals keep the proportions of capitals (a wide "L", an "R" as
   *    wide as a "D"), small letters those of small letters (an "l" as
   *    narrow as an "i", a narrow "r" and "t"). The flipped glyphs' widths,
   *    and those of the font's glyphs whose case is not in doubt, are set
   *    against the Helvetica capitals and small letters, and the names are
   *    believed when the widths follow the named case more closely (the
   *    spread of the log ratios: one scale factor fits a typeface of the
   *    same proportions). Frutiger's key follows the small letters, the
   *    Patons Gotham, the Sandnes Verlag and the Interweave Avenir headings
   *    the capitals.
   *  - With fewer than three glyphs to go on: the font's own glyph for the
   *    letter in the case the map gives. A capital drawn at a small letter's
   *    code is wider than the real small letter ("h" 741 against "h" 556);
   *    a second copy of the small letter is as wide. */
  var HELV_UPPER = [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
    722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611];
  var HELV_LOWER = [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
    556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500];
  var SHAPE_MIN_GLYPHS = 3;
  var SHAPE_WIDER = 1.08;      // a capital is this much wider than its own small letter

  function drawnAsNamed(shapes, real) {
    var yes = 0, no = 0, code, s, k;
    var up = [], low = [];
    for (code in shapes) {
      s = shapes[code];
      k = s.name.toUpperCase().charCodeAt(0) - 65;
      if (!(s.w > 0) || k < 0 || k > 25) continue;
      var capital = /[A-Z]/.test(s.name);
      var w0 = real[s.u];
      if (w0 > 0) {
        if ((capital ? s.w / w0 : w0 / s.w) >= SHAPE_WIDER) yes++;
        else no++;
      }
      up.push(Math.log(s.w / (capital ? HELV_UPPER[k] : HELV_LOWER[k])));
      low.push(Math.log(s.w / (capital ? HELV_LOWER[k] : HELV_UPPER[k])));
    }
    if (!up.length) return false;
    for (var u in real) {
      k = u.toUpperCase().charCodeAt(0) - 65;
      if (!(real[u] > 0) || k < 0 || k > 25) continue;
      var known = Math.log(real[u] / (u === u.toUpperCase() ? HELV_UPPER[k] : HELV_LOWER[k]));
      up.push(known);
      low.push(known);
    }
    if (up.length < SHAPE_MIN_GLYPHS) return yes > no;
    var spread = function (a) {
      var m = 0, v = 0, i;
      for (i = 0; i < a.length; i++) m += a[i] / a.length;
      for (i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m) / a.length;
      return Math.sqrt(v);
    };
    return spread(up) < spread(low);     // `up`: the widths read as the names say
  }

  /* A font already caught is restored on later pages from the text where
   * it can be. A letter the font draws only one way says itself; a letter
   * it has both glyphs for (Sandnes' Verlag: "a" at 97, width 436, and the
   * capital at 65, width 681, both mapped to "a") is told by the run's
   * width: a run of capitals is as wide as the capitals' widths add up to,
   * a run of small letters as wide as theirs. A run that fits one reading
   * within CASE_FIT and misses the other by CASE_MISS takes it; a run that
   * fits neither (a mix, character spacing) is left to the operator list. */
  var CASE_FIT = 0.03;
  var CASE_MISS = 0.06;

  /** {char: {real, flip, name}}: the widths of each character's glyphs. */
  function widthInfo(fo) {
    var map = fo && fo.toUnicode && fo.toUnicode._map, w = fo && fo.widths;
    if (!map || !w) return null;
    var codes = {};
    for (var code in map) {
      var u = map[code];
      // a code with no width has no glyph: a font in a standard encoding
      // maps all 256 codes, used or not
      if (typeof u !== 'string' || u.length !== 1 || !(w[code] > 0)) continue;
      var name = glyphName(fo, +code);
      var flipped = ASCII_LETTER_RE.test(u) && ASCII_LETTER_RE.test(name) && name !== u &&
        name.toLowerCase() === u.toLowerCase();
      var c = codes[u] || (codes[u] = { real: 0, flip: 0, name: null });
      if (flipped) {
        if (!c.flip) { c.flip = w[code]; c.name = name; }
      } else if (!c.real) {
        c.real = w[code];
      }
    }
    return codes;
  }

  /** The run's text read by its width, or null when the width does not say. */
  function caseByWidth(it, codes) {
    var t = it.transform, size = t ? Math.sqrt(t[0] * t[0] + t[1] * t[1]) : 0;
    var em0 = 0, em1 = 0, mixed = false;
    for (var i = 0; i < it.str.length; i++) {
      var c = codes[it.str.charAt(i)];
      if (!c) return null;
      if (c.real && c.flip) mixed = true;
      em0 += c.real || c.flip;
      em1 += c.flip || c.real;
    }
    var restore = function (all) {
      return it.str.replace(/[A-Za-z]/g, function (ch) {
        var k = codes[ch];
        return k && k.flip && (all || !k.real) ? k.name : ch;
      });
    };
    if (!mixed) return restore(false);     // every letter has one glyph only
    if (!(size > 0) || !(it.width > 0)) return null;
    var d0 = Math.abs(Math.log(it.width / (em0 / 1000 * size)));
    var d1 = Math.abs(Math.log(it.width / (em1 / 1000 * size)));
    if (d0 <= CASE_FIT && d1 >= CASE_MISS) return restore(false);
    if (d1 <= CASE_FIT && d0 >= CASE_MISS) return restore(true);
    return null;
  }

  /**
   * `items` with the case of every glyph restored from its name, for the
   * fonts on the page whose map flips it. `state` (newCaseState) carries
   * what is known across pages. -> {items, fonts: {fontName: true}}
   */
  function restoreCase(items, ol, OPS, objs, state) {
    state = state || newCaseState();
    var fonts = {}, queues = {}, bad = {}, tally = {}, any = false;
    var fontOf = function (name) {
      if (!(name in fonts)) {
        var fo = null;
        try { if (objs && objs.has(name)) fo = objs.get(name); } catch (e) { fo = null; }
        fonts[name] = fo && (fo.differences || fo.defaultEncoding) ? fo : null;
      }
      return fonts[name];
    };
    var font = null, stack = [];
    var show = function (glyphs) {
      var fo = font && fontOf(font);
      if (!fo || !glyphs) return;
      var q = queues[font] || (queues[font] = []);
      var t = tally[font] || (tally[font] = { flip: 0, wrong: 0, shapes: {}, real: {}, name: fo.name || font });
      for (var i = 0; i < glyphs.length; i++) {
        var g = glyphs[i];
        if (!g || typeof g !== 'object' || typeof g.unicode !== 'string') continue;
        if (!ASCII_LETTER_RE.test(g.unicode)) {
          // a ligature ("fi") is its letters, none of them to restore
          if (/^[A-Za-z]{2,3}$/.test(g.unicode)) {
            for (var l = 0; l < g.unicode.length; l++) q.push({ u: g.unicode.charAt(l), fix: null });
          }
          continue;
        }
        var name = glyphName(fo, g.originalCharCode), fix = null;
        if (ASCII_LETTER_RE.test(name)) {
          if (name.toLowerCase() !== g.unicode.toLowerCase()) t.wrong++;
          else if (name !== g.unicode) {
            fix = name;
            t.flip++;
            t.shapes[g.originalCharCode] = { name: name, u: g.unicode, w: g.width };
          } else if (g.width > 0) t.real[g.unicode] = g.width;
        } else if (name && !UNI_NAME_RE.test(name)) {
          t.wrong++;          // "four" for a "c": the names say nothing
        }
        q.push({ u: g.unicode, fix: fix });
      }
    };
    for (var i = 0; i < ol.fnArray.length; i++) {
      var fn = ol.fnArray[i], a = ol.argsArray[i];
      if (fn === OPS.save) stack.push(font);
      else if (fn === OPS.restore) { if (stack.length) font = stack.pop(); }
      else if (fn === OPS.setFont) font = a && a[0];
      else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText) show(a && a[0]);
      else if (fn === OPS.nextLineSetSpacingShowText) show(a && a[2]);
    }
    // Names are only believed in a font where none of them names another
    // letter: an OCR layer's CID fonts name their glyphs anything at all
    // ("B" for a "u", "four" for a "c"), and their few "B" for "b" are chance.
    // The widths are pooled over the pages read so far, and over every copy
    // of the same subset font (a book gives each page its own font object):
    // a page with one heading may hold a single flipped glyph.
    for (var f in tally) {
      var t = tally[f];
      if (t.wrong) continue;
      var pool = state.shapes[t.name] || (state.shapes[t.name] = { flipped: {}, real: {} });
      for (var code in t.shapes) pool.flipped[code] = t.shapes[code];
      for (var u in t.real) pool.real[u] = t.real[u];
      if (!t.flip) continue;
      if (state.fonts[f] || state.named[t.name] || drawnAsNamed(pool.flipped, pool.real)) {
        bad[f] = state.fonts[f] = state.named[t.name] = any = true;
        if (!(f in state.wide)) state.wide[f] = widthInfo(fonts[f]);
      }
    }
    if (!any) return { items: items, fonts: bad };
    // Each text item is found in its font's glyph stream as one unbroken
    // run of its letters, from where the last item matched: a lone letter
    // only a few glyphs on, a longer item anywhere further. An item that is
    // not found exactly (a reordered run) keeps its text as it came:
    // matching letter by letter drifted onto the wrong "e" ("havE").
    var at = {};
    var out = items.map(function (it) {
      var q = it && bad[it.fontName] && queues[it.fontName];
      if (!q || typeof it.str !== 'string') return it;
      var letters = [], where = [];
      for (var c = 0; c < it.str.length; c++) {
        if (ASCII_LETTER_RE.test(it.str.charAt(c))) { letters.push(it.str.charAt(c)); where.push(c); }
      }
      if (!letters.length) return it;
      var p = at[it.fontName] || 0, n = letters.length;
      var last = (n >= CASE_MIN_RUN ? q.length : Math.min(q.length, p + CASE_LOOKAHEAD)) - n;
      var hit = -1;
      for (var k = p; k <= last && hit < 0; k++) {
        var j = 0;
        while (j < n && q[k + j].u === letters[j]) j++;
        if (j === n) hit = k;
      }
      if (hit < 0) return it;
      at[it.fontName] = hit + n;
      var chars = it.str.split(''), changed = false;
      for (j = 0; j < n; j++) {
        if (q[hit + j].fix) { chars[where[j]] = q[hit + j].fix; changed = true; }
      }
      if (!changed) return it;
      var copy = {};
      for (var key in it) copy[key] = it[key];
      copy.str = chars.join('');
      return copy;
    });
    return { items: out, fonts: bad };
  }

  /**
   * A page's text items with the hidden runs removed when the page shows
   * the symptoms of hidden text (or `force`), and the case of a font that
   * flips it restored (see above; `state` is a newCaseState, kept for the
   * whole document). -> {items, checked, applied: {fontName: true}}
   */
  function visibleItems(page, force, state) {
    state = state || newCaseState();
    return page.getTextContent().then(function (tc) {
      var items = tc.items || [];
      var OPS = window.pdfjsLib && window.pdfjsLib.OPS;
      if (!OPS || typeof page.getOperatorList !== 'function') return { items: items, checked: false, applied: {} };
      // A font already caught is restored from the text where its runs'
      // widths say how (caseByWidth); any run they leave in doubt sends
      // the page to the operator list like a first sighting does.
      var known = {}, done = {}, pending = false;
      var fixed = items.map(function (it) {
        var f = it && it.fontName;
        if (!f || !state.fonts[f] || typeof it.str !== 'string') return it;
        known[f] = true;
        var s = state.wide[f] ? caseByWidth(it, state.wide[f]) : null;
        if (s === null) { pending = true; return it; }
        if (s === it.str) return it;
        var copy = {};
        for (var key in it) copy[key] = it[key];
        copy.str = s;
        return copy;
      });
      var hide = !!(force || overlaySuspect(items));
      var recase = pending || caseSuspect(items, tc.styles, known);
      if (!pending) { items = fixed; done = known; }
      if (!hide && !recase) return { items: items, checked: false, applied: done };
      return page.getOperatorList().then(function (ol) {
        if (hide) items = dropHiddenItems(items, textVisibility(ol, OPS, imageAlphaOf(page)));
        if (recase) {
          var rc = restoreCase(items, ol, OPS, page.commonObjs, state);
          items = rc.items;
          for (var f in rc.fonts) done[f] = true;
        }
        return { items: items, checked: hide, applied: done };
      }, function () {
        return { items: items, checked: hide, applied: done };
      });
    });
  }

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
          disableFontFace: true,
          // glyph names for restoreCase
          fontExtraProperties: true
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

        var caseState = newCaseState();   // see restoreCase: the pages read so far
        var attached = {};                // wave K: page -> OCR lines (setPageText)

        function textOf(pageNo) {
          var stop = guard();
          if (stop) return Promise.reject(stop);
          var n = parseInt(pageNo, 10);
          if (!isFinite(n) || n < 1 || n > (doc.numPages || 0)) {
            return Promise.resolve('');
          }
          return doc.getPage(n).then(function (page) {
            return visibleItems(page, null, caseState).then(function (vis) {
              var size = pageSize(page);
              var res = pageLines(vis.items, size.width, size.height, page.rotate);
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
            pageText: function (p) { return attached[p] || null; },
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

        var handle = {
          doc: doc,
          numPages: doc.numPages || 0,
          textOf: textOf,
          extract: extractAll,
          renderPage: renderPage,
          destroy: release
        };
        // wave K: page structure, glyphs, layers, regions (section 8)
        return addStructure(handle, {
          doc: doc,
          guard: guard,
          stopped: function () { return isCancelled(signal) || destroyed; },
          caseState: caseState,
          attached: attached
        });
      })
      .then(null, function (err) {
        throw friendlyError(err);
      });
  }

  /* ================================================================== *
   * 8. Page structure (wave K): where things are, not only what they say
   *
   * Everything here is additive. The text pipeline above is untouched;
   * buildRows only gives each row item its font and page box, and
   * pageLines each line a `geo`, which readDoc and textOf never copy.
   * The contract is docs/wave-k/api/pdftext.md.
   *
   *   handle.layout(n)        lines with boxes and fonts, image draws,
   *                           drawing regions, captions, layers, a kind hint
   *   handle.textIn(n, rect)  the text inside a rectangle
   *   handle.glyphs(n)        every glyph: font, code, unicode, box, advance
   *   handle.renderGlyph(font, code)  one glyph of an embedded font
   *   handle.layers()         optional content (size layers)
   *   handle.renderRegion(n, rect)    any rectangle at any density, capped
   *   handle.renderTiles(n, rect, opts, onTile)
   *   handle.pageKinds()      a cheap per-page guess with reasons
   *
   * Coordinates are the page as shown: pdf.js viewport at scale 1, origin
   * top left, y down; `nbox` is the same box over the page's width and
   * height (0..1).
   * ================================================================== */
  var LAYOUT_VERSION = 1;
  var MAX_RENDER_PIXELS = 4194304;     // 2048 x 2048: a phone's canvas is safe below this
  var MAX_RENDER_SIDE = 4096;
  var LAYOUT_CACHE = 8;                // pages kept on a handle
  var MAX_GLYPHS = 120000;             // a 500 x 500 symbol chart page fits
  var MAX_SEGMENTS = 60000;            // axis-aligned segments kept per page for grid checks
  var BACKGROUND_SHARE = 0.85;         // a path this much of the page is the page's ground
  var PANEL_SHARE = 0.5;               // ...a fill this big is a panel behind other things
  // "Figure 3", "Fig. 3", "DIAGRAM B1", "Diagram B"; not "(Figure 3)", which
  // is a step naming its figure, not the caption printed under it
  var CAPTION_RE = /^(fig(?:ure)?s?\.?|diagram|diag\.|illustration|illus\.|chart|photo|picture|image)\s*([A-Z]?[0-9]{1,3}[a-z]?|[A-Z](?![a-z]))\b/i;
  var CAPTION_AGAIN_RE = /\s(?=(?:fig(?:ure)?s?\.?|diagram|diag\.)\s*(?:[A-Z]?[0-9]{1,3}[a-z]?|[A-Z](?![a-z]))\b)/ig;

  /** A path that is one axis-aligned rectangle: a `re`, or four or five
   * points each on two edges of the box (corners only). */
  function isRectPath(ops, coords, OPS) {
    if (!ops || !coords) return false;
    var rects = 0, other = 0;
    for (var i = 0; i < ops.length; i++) {
      if (ops[i] === OPS.rectangle) rects++;
      else if (ops[i] === OPS.moveTo || ops[i] === OPS.lineTo) other++;
      else if (ops[i] !== OPS.closePath) return false;
    }
    if (rects) return rects === 1 && !other;
    if (other < 4 || other > 5 || coords.length < 8) return false;
    var xs = [], ys = [];
    for (var k = 0; k + 1 < coords.length; k += 2) { xs.push(coords[k]); ys.push(coords[k + 1]); }
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var e = Math.max(0.01, Math.min(x1 - x0, y1 - y0) * 0.02);
    for (k = 0; k < xs.length; k++) {
      var onX = Math.abs(xs[k] - x0) <= e || Math.abs(xs[k] - x1) <= e;
      var onY = Math.abs(ys[k] - y0) <= e || Math.abs(ys[k] - y1) <= e;
      if (!onX || !onY) return false;
    }
    return x1 - x0 > 0 && y1 - y0 > 0;
  }
  var CAPTION_MAX_CHARS = 90;

  /** A text item's box in PDF space [x0, y0, x1, y1]: its advance by its
   * font height, a fifth of it below the baseline. Any rotation. */
  function itemBox(it, w) {
    var t = it && it.transform;
    if (!t || t.length < 6) return null;
    var size = Math.sqrt(t[0] * t[0] + t[1] * t[1]) || Math.abs(t[3]) || 0;
    if (!(size > 0)) return [t[4], t[5], t[4], t[5]];
    return boxM(t, 0, -0.22, (w > 0 ? w : 0) / size, 0.78);
  }

  /** {box (PDF space), font, size, col} of a built row. */
  function rowGeo(row, col) {
    if (!row || !row.items) return null;
    var b = null, fonts = {}, best = '', bestN = -1, size = 0;
    row.items.forEach(function (it) {
      if (it.box) b = b ? [Math.min(b[0], it.box[0]), Math.min(b[1], it.box[1]), Math.max(b[2], it.box[2]), Math.max(b[3], it.box[3])] : it.box.slice();
      var n = (it.str || '').replace(/\s/g, '').length;
      if (it.font) fonts[it.font] = (fonts[it.font] || 0) + n;
      if (n && it.h > size) size = it.h;
    });
    for (var f in fonts) if (fonts[f] > bestN) { bestN = fonts[f]; best = f; }
    return { box: b, font: best, size: size, col: typeof col === 'number' ? col : 0 };
  }

  /** PDF-space box -> {x0,y0,x1,y1} in the page as shown (viewport transform vt). */
  function toViewBox(vt, b) {
    if (!b) return null;
    var q = boxM(vt, b[0], b[1], b[2], b[3]);
    return { x0: r2(q[0]), y0: r2(q[1]), x1: r2(q[2]), y1: r2(q[3]) };
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  function normBox(b, W, H) {
    if (!b || !(W > 0) || !(H > 0)) return null;
    return { x0: r4(b.x0 / W), y0: r4(b.y0 / H), x1: r4(b.x1 / W), y1: r4(b.y1 / H) };
  }
  function vArea(b) { return b ? Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0) : 0; }
  function vCut(a, b) {
    return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  }
  function vUnion(a, b) {
    if (!a) return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  }
  /** A caller's rect in page units ({x0,y0,x1,y1}, or x/y/w/h; `norm` for 0..1). */
  function readRect(rect, W, H) {
    if (!rect) return { x0: 0, y0: 0, x1: W, y1: H };
    var x0 = rect.x0, y0 = rect.y0, x1 = rect.x1, y1 = rect.y1;
    if (x0 == null && rect.x != null) { x0 = rect.x; y0 = rect.y; x1 = rect.x + (rect.w || rect.width || 0); y1 = rect.y + (rect.h || rect.height || 0); }
    x0 = +x0 || 0; y0 = +y0 || 0; x1 = +x1 || 0; y1 = +y1 || 0;
    if (rect.norm) { x0 *= W; x1 *= W; y0 *= H; y1 *= H; }
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }
  function hexOf(a) {
    if (!a || a.length < 3) return null;
    var h = '#';
    for (var i = 0; i < 3; i++) h += ('0' + Math.max(0, Math.min(255, Math.round(+a[i] || 0))).toString(16)).slice(-2);
    return h;
  }
  function baseFontName(name) { return String(name || '').replace(/^[A-Z]{6}\+/, ''); }

  /**
   * One walk of a page's operator list: image draws, painted paths, glyphs
   * and the optional-content layer each sits in. Boxes in PDF space.
   * @param {{fnArray:number[], argsArray:Array}} ol
   * @param {Object} OPS pdfjsLib.OPS
   * @param {{glyphs?:boolean}} [opts]
   * @returns {{images, paths, glyphs, layers, ops, segments}}
   */
  function pageGraphics(ol, OPS, opts) {
    opts = opts || {};
    var wantGlyphs = opts.glyphs !== false;
    var fns = (ol && ol.fnArray) || [], args = (ol && ol.argsArray) || [];
    var gs = { ctm: [1, 0, 0, 1, 0, 0], clip: null, fill: '#000000', stroke: '#000000', fillPat: false,
      lw: 1, font: '', fs: 10, cs: 0, ws: 0, hs: 1, lead: 0, rise: 0, mode: 0, ca: 1 };
    var stack = [], oc = [];
    var tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
    var images = [], paths = [], glyphs = [], layers = {}, segments = 0;
    var pending = null;              // the path built and not yet painted
    var runNo = 0;
    var copy = function (g) { var o = {}; for (var k in g) o[k] = g[k]; return o; };
    var layer = function () {
      for (var i = oc.length - 1; i >= 0; i--) if (oc[i]) return oc[i];
      return null;
    };
    var withClip = function (b) {
      if (!gs.clip) return { box: b, clipped: false };
      var c = boxCut(b, gs.clip);
      return { box: c, clipped: boxArea(c) < boxArea(b) * 0.98 };
    };
    var addImage = function (id, w, h, mask, inline, m) {
      var b = boxM(m || gs.ctm, 0, 0, 1, 1), cl = withClip(b);
      if (!(boxArea(cl.box) > 0)) return;
      images.push({ id: typeof id === 'string' ? id : null, op: i, box: cl.box, full: b, px: w > 0 && h > 0 ? { w: w, h: h } : null,
        mask: !!mask, inline: !!inline, layer: layer(), clipped: cl.clipped, colour: mask ? gs.fill : null });
    };
    /* the axis-aligned segments of a path, for the grid check */
    var segsOf = function (ops, coords, m) {
      var vx = [], hy = [], rects = [];
      var x = 0, y = 0, sx = 0, sy = 0, k = 0;
      var lx = Infinity, ly = Infinity, hx = -Infinity, hy2 = -Infinity;
      var pt = function (px, py) {
        if (px < lx) lx = px; if (px > hx) hx = px;
        if (py < ly) ly = py; if (py > hy2) hy2 = py;
      };
      var seg = function (x0, y0, x1, y1) {
        var p = applyM(m, x0, y0), q = applyM(m, x1, y1);
        var dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
        if (dx < 0.3 && dy > 1) vx.push((p[0] + q[0]) / 2, Math.min(p[1], q[1]), Math.max(p[1], q[1]));
        else if (dy < 0.3 && dx > 1) hy.push((p[1] + q[1]) / 2, Math.min(p[0], q[0]), Math.max(p[0], q[0]));
      };
      var full = true;
      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        var keepSeg = segments < MAX_SEGMENTS;
        if (!keepSeg) full = false;
        if (op === OPS.moveTo) { x = sx = coords[k]; y = sy = coords[k + 1]; pt(x, y); k += 2; }
        else if (op === OPS.lineTo) {
          if (keepSeg) { seg(x, y, coords[k], coords[k + 1]); segments++; }
          x = coords[k]; y = coords[k + 1]; pt(x, y); k += 2;
        }
        else if (op === OPS.curveTo) { pt(coords[k], coords[k + 1]); pt(coords[k + 2], coords[k + 3]); x = coords[k + 4]; y = coords[k + 5]; pt(x, y); k += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { pt(coords[k], coords[k + 1]); x = coords[k + 2]; y = coords[k + 3]; pt(x, y); k += 4; }
        else if (op === OPS.closePath) { if (keepSeg) seg(x, y, sx, sy); x = sx; y = sy; }
        else if (op === OPS.rectangle) {
          var rx0 = coords[k], ry0 = coords[k + 1], rx1 = coords[k] + coords[k + 2], ry1 = coords[k + 1] + coords[k + 3];
          pt(rx0, ry0); pt(rx1, ry1);
          if (keepSeg) {
            var rb = boxM(m, rx0, ry0, rx1, ry1);
            rects.push(rb[0], rb[1], rb[2], rb[3]);
            segments++;
          }
          x = sx = rx0; y = sy = ry0;
          k += 4;
        }
      }
      return { vx: vx, hy: hy, rects: rects, bb: isFinite(lx) ? [lx, ly, hx, hy2] : null, full: full };
    };
    var paint = function (fill, stroke) {
      var p = pending;
      pending = null;
      if (!p) return;
      var b = p.box;
      if (stroke) {
        var pad = Math.max(0.25, gs.lw * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) / 2);
        b = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
      }
      var cl = withClip(b);
      if (!(cl.box[2] >= cl.box[0] && cl.box[3] >= cl.box[1])) return;
      if (boxArea(cl.box) <= 0 && !(cl.box[2] - cl.box[0] > 0 || cl.box[3] - cl.box[1] > 0)) return;
      paths.push({ box: cl.box, fill: fill ? (gs.fillPat ? 'pattern' : gs.fill) : null, stroke: stroke ? gs.stroke : null,
        rect: p.rect, nops: p.nops, layer: layer(), vx: p.segs.vx, hy: p.segs.hy, rects: p.segs.rects,
        alpha: gs.ca });
    };
    var moveText = function (x, y) {
      tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + x * tlm[0] + y * tlm[2], tlm[5] + x * tlm[1] + y * tlm[3]];
      tm = tlm.slice();
    };
    var show = function (list) {
      if (!list || !list.length) return;
      runNo++;
      var adv = 0, m = mulM(gs.ctm, tm);
      var scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      for (var i = 0; i < list.length; i++) {
        var gl = list[i];
        if (typeof gl === 'number') { adv -= gl * gs.fs / 1000 * gs.hs; continue; }
        if (!gl) continue;
        var w = typeof gl.width === 'number' ? gl.width : 500;
        var a = (w * gs.fs / 1000 + gs.cs + (gl.isSpace ? gs.ws : 0)) * gs.hs;
        if (wantGlyphs && glyphs.length < MAX_GLYPHS) {
          var gb = boxM(m, adv, gs.rise - 0.2 * gs.fs, adv + w * gs.fs / 1000 * gs.hs, gs.rise + 0.8 * gs.fs);
          glyphs.push({ font: gs.font, code: gl.originalCharCode, unicode: typeof gl.unicode === 'string' ? gl.unicode : '',
            fontChar: gl.fontChar, box: gb, advance: a * scale, size: gs.fs * scale, space: !!gl.isSpace,
            invisible: gs.mode === 3 || gs.mode === 7, run: runNo, layer: layer() });
        }
        adv += a;
      }
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + adv * tm[0], tm[5] + adv * tm[1]];
    };
    for (var i = 0; i < fns.length; i++) {
      var fn = fns[i], a = args[i] || [];
      switch (fn) {
        case OPS.save: stack.push(copy(gs)); break;
        case OPS.restore: if (stack.length) gs = stack.pop(); break;
        case OPS.transform: gs.ctm = mulM(gs.ctm, a); break;
        case OPS.paintFormXObjectBegin:
          stack.push(copy(gs));
          if (a[0] && a[0].length === 6) gs.ctm = mulM(gs.ctm, a[0]);
          if (a[1] && a[1].length === 4) gs.clip = boxCut(gs.clip, boxM(gs.ctm, a[1][0], a[1][1], a[1][2], a[1][3]));
          break;
        case OPS.paintFormXObjectEnd: if (stack.length) gs = stack.pop(); break;
        case OPS.beginGroup: stack.push(copy(gs)); break;
        case OPS.endGroup: if (stack.length) gs = stack.pop(); break;
        case OPS.beginMarkedContentProps:
          var id = null;
          if (a[0] === 'OC' && a[1]) {
            if (a[1].type === 'OCG' && a[1].id) id = a[1].id;
            else if (a[1].ids && a[1].ids.length) id = a[1].ids[0];
            if (id) layers[id] = true;
          }
          oc.push(id);
          break;
        case OPS.beginMarkedContent: oc.push(null); break;
        case OPS.endMarkedContent: oc.pop(); break;
        case OPS.setGState:
          (a[0] || []).forEach(function (kv) {
            if (!kv) return;
            if (kv[0] === 'ca') gs.ca = kv[1];
            else if (kv[0] === 'LW') gs.lw = +kv[1] || 0;
            else if (kv[0] === 'Font' && kv[1] && typeof kv[1][1] === 'number') gs.fs = kv[1][1];
          });
          break;
        case OPS.setLineWidth: gs.lw = +a[0] || 0; break;
        case OPS.setFillRGBColor: gs.fill = hexOf(a) || gs.fill; gs.fillPat = false; break;
        case OPS.setStrokeRGBColor: gs.stroke = hexOf(a) || gs.stroke; break;
        case OPS.setFillColorN: if (a[0] === 'TilingPattern' || a[0] === 'Shading' || typeof a[0] === 'string') gs.fillPat = true; break;
        case OPS.constructPath:
          var mm = a[2];
          if (!(mm && mm.length === 4 && isFinite(mm[0]) && isFinite(mm[2]))) { pending = null; break; }
          var pb = boxM(gs.ctm, mm[0], mm[2], mm[1], mm[3]);
          // pdf.js leaves a curve's own points out of the min/max: take
          // every coordinate (control points too: a box that holds the curve)
          var sg = segsOf(a[0] || [], a[1] || [], gs.ctm);
          if (sg.bb) {
            var cb = boxM(gs.ctm, sg.bb[0], sg.bb[1], sg.bb[2], sg.bb[3]);
            pb = [Math.min(pb[0], cb[0]), Math.min(pb[1], cb[1]), Math.max(pb[2], cb[2]), Math.max(pb[3], cb[3])];
          }
          if (pending) {      // two builds before one paint: one path
            pb = [Math.min(pb[0], pending.box[0]), Math.min(pb[1], pending.box[1]), Math.max(pb[2], pending.box[2]), Math.max(pb[3], pending.box[3])];
          }
          if (pending) {
            sg.vx = pending.segs.vx.concat(sg.vx); sg.hy = pending.segs.hy.concat(sg.hy); sg.rects = pending.segs.rects.concat(sg.rects);
          }
          pending = { box: pb, rect: !pending && isRectPath(a[0], a[1], OPS), nops: (a[0] || []).length + (pending ? pending.nops : 0), segs: sg };
          break;
        case OPS.clip:
        case OPS.eoClip:
          if (pending) gs.clip = boxCut(gs.clip, pending.box);
          break;
        case OPS.endPath: pending = null; break;
        case OPS.fill:
        case OPS.eoFill: paint(true, false); break;
        case OPS.stroke:
        case OPS.closeStroke: paint(false, true); break;
        case OPS.fillStroke:
        case OPS.eoFillStroke:
        case OPS.closeFillStroke:
        case OPS.closeEOFillStroke: paint(true, true); break;
        case OPS.shadingFill:
          if (gs.clip) paths.push({ box: gs.clip.slice(), fill: 'shading', stroke: null, rect: true, nops: 1, layer: layer(), vx: [], hy: [], rects: [], alpha: gs.ca });
          break;
        case OPS.paintImageXObject: addImage(a[0], a[1], a[2], false, false); break;
        case OPS.paintInlineImageXObject: addImage(null, a[0] && a[0].width, a[0] && a[0].height, false, true); break;
        case OPS.paintImageMaskXObject: addImage(null, a[0] && a[0].width, a[0] && a[0].height, true, true); break;
        case OPS.paintSolidColorImageMask: addImage(null, 1, 1, true, true); break;
        case OPS.paintImageXObjectRepeat:
          // [id, scaleX, scaleY, positions]: one draw per position
          var pos = a[3] || [];
          for (var q = 0; q + 1 < pos.length; q += 2) {
            addImage(a[0], 0, 0, false, false, mulM(gs.ctm, [a[1], 0, 0, a[2], pos[q], pos[q + 1]]));
          }
          break;
        case OPS.paintImageMaskXObjectRepeat:
          var mp = a[5] || [];
          for (var r = 0; r + 1 < mp.length; r += 2) {
            addImage(null, a[0] && a[0].width, a[0] && a[0].height, true, true, mulM(gs.ctm, [a[1], a[2], a[3], a[4], mp[r], mp[r + 1]]));
          }
          break;
        case OPS.paintImageMaskXObjectGroup:
          (a[0] || []).forEach(function (im) {
            addImage(null, im && im.width, im && im.height, true, true, im && im.transform ? mulM(gs.ctm, im.transform) : null);
          });
          break;
        case OPS.beginText: tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case OPS.setFont: gs.font = a[0] || ''; if (typeof a[1] === 'number') gs.fs = a[1]; break;
        case OPS.setCharSpacing: gs.cs = +a[0] || 0; break;
        case OPS.setWordSpacing: gs.ws = +a[0] || 0; break;
        case OPS.setHScale: gs.hs = (+a[0] || 100) / 100; break;
        case OPS.setLeading: gs.lead = +a[0] || 0; break;
        case OPS.setTextRise: gs.rise = +a[0] || 0; break;
        case OPS.setTextRenderingMode: gs.mode = +a[0] || 0; break;
        case OPS.setTextMatrix: tm = a.slice(0, 6); tlm = tm.slice(); break;
        case OPS.moveText: moveText(+a[0] || 0, +a[1] || 0); break;
        case OPS.setLeadingMoveText: gs.lead = -(+a[1] || 0); moveText(+a[0] || 0, +a[1] || 0); break;
        case OPS.nextLine: moveText(0, -gs.lead); break;
        case OPS.showText:
        case OPS.showSpacedText: show(a[0]); break;
        case OPS.nextLineShowText: moveText(0, -gs.lead); show(a[0]); break;
        case OPS.nextLineSetSpacingShowText:
          gs.ws = +a[0] || 0; gs.cs = +a[1] || 0; moveText(0, -gs.lead); show(a[2]); break;
        default: break;
      }
    }
    return { images: images, paths: paths, glyphs: glyphs, layers: Object.keys(layers), ops: fns.length, segments: segments };
  }

  /* ---- Periodicity: is a set of positions a lattice? ------------------ */
  var PERIOD_MIN_LINES = 6;
  var PERIOD_FIT = 0.7;

  /** {pitch, count, min, max} when the positions sit on one pitch, else null. */
  function periodOf(pos, minPitch, jitter) {
    if (!pos || pos.length < PERIOD_MIN_LINES) return null;
    var s = pos.slice().sort(function (a, b) { return a - b; });
    // positions within `jitter` of each other are one line (glyphs of
    // different widths centred in one column wander by half a point)
    var tol = jitter > 0.35 ? jitter : 0.35;
    var u = [], start = 0, sum = s[0];
    for (var i = 1; i <= s.length; i++) {
      if (i < s.length && s[i] - s[i - 1] <= tol) { sum += s[i]; continue; }
      u.push(sum / (i - start));
      start = i;
      if (i < s.length) sum = s[i];
    }
    if (u.length < PERIOD_MIN_LINES) return null;
    var d = [];
    for (i = 1; i < u.length; i++) d.push(u[i] - u[i - 1]);
    var bins = {}, best = null, bestN = 0;
    d.forEach(function (v) {
      if (v < (minPitch || 1.5)) return;
      var k = Math.round(v * 4) / 4;
      bins[k] = (bins[k] || 0) + 1;
      var n = bins[k] + (bins[k - 0.25] || 0) + (bins[k + 0.25] || 0);
      if (n > bestN) { bestN = n; best = k; }
    });
    if (!best) return null;
    // the pitch is the mean of the diffs near the modal one; a diff that is
    // a whole number of pitches (an empty cell) still fits
    var sum = 0, n = 0;
    d.forEach(function (v) { if (Math.abs(v - best) <= best * 0.1) { sum += v; n++; } });
    var pitch = n ? sum / n : best;
    var fit = 0;
    d.forEach(function (v) {
      var k = Math.round(v / pitch);
      if (k >= 1 && Math.abs(v - k * pitch) <= pitch * 0.15) fit++;
    });
    if (fit / d.length < PERIOD_FIT) return null;
    // the extent is the longest run that stays on the lattice: a centre
    // mark or a frame just outside the grid is not a grid line
    var bestRun = null, runStart = 0;
    var fits = function (v) { var k = Math.round(v / pitch); return k >= 1 && k <= 3 && Math.abs(v - k * pitch) <= pitch * 0.15; };
    for (i = 1; i <= u.length; i++) {
      if (i < u.length && fits(u[i] - u[i - 1])) continue;
      if (!bestRun || i - runStart > bestRun[1] - bestRun[0]) bestRun = [runStart, i];
      runStart = i;
    }
    if (bestRun[1] - bestRun[0] < PERIOD_MIN_LINES) return null;
    return { pitch: pitch, count: bestRun[1] - bestRun[0], min: u[bestRun[0]], max: u[bestRun[1] - 1] };
  }

  /**
   * Cluster painted paths into drawing regions (boxes already in view
   * space), and describe each: a grid, a swatch, a rule, a box or a figure.
   * Paths are joined when their boxes touch on a coarse raster (one cell
   * of about 4 pt), so it costs the area painted, never paths squared.
   */
  function drawingRegions(paths, W, H) {
    var out = { drawings: [], backgrounds: 0 };
    if (!paths || !paths.length || !(W > 0) || !(H > 0)) return out;
    var pageA = W * H;
    var cell = Math.max(4, Math.sqrt(pageA / 160000));
    var cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
    var grid = new Int32Array(cols * rows);
    for (var g = 0; g < grid.length; g++) grid[g] = -1;
    var parent = new Int32Array(paths.length);
    for (var p = 0; p < paths.length; p++) parent[p] = p;
    var find = function (x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    var join = function (a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    var keep = new Uint8Array(paths.length);
    var mark = function (i, x0, y0, x1, y1) {
      var c0 = Math.max(0, Math.floor(x0 / cell)), c1 = Math.min(cols - 1, Math.floor(x1 / cell));
      var r0 = Math.max(0, Math.floor(y0 / cell)), r1 = Math.min(rows - 1, Math.floor(y1 / cell));
      for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) {
          var k = r * cols + c;
          if (grid[k] >= 0) join(grid[k], i);
          grid[k] = i;
        }
      }
    };
    var half = cell / 2;
    paths.forEach(function (pt, i) {
      var b = pt.vbox;
      if (!b) return;
      var a = vArea(b);
      var white = pt.fill === '#ffffff' && !pt.stroke;
      if (a >= pageA * BACKGROUND_SHARE || (pt.fill && !pt.stroke && a >= pageA * PANEL_SHARE)) { out.backgrounds++; return; }
      if (white && a >= pageA * 0.02) { out.backgrounds++; return; }   // a white knock-out panel
      keep[i] = 1;
      // a stroked frame joins what touches its edges, not all it encloses
      if (pt.stroke && !pt.fill && pt.rect && a > cell * cell * 64) {
        mark(i, b.x0 - half, b.y0 - half, b.x1 + half, b.y0 + half);
        mark(i, b.x0 - half, b.y1 - half, b.x1 + half, b.y1 + half);
        mark(i, b.x0 - half, b.y0 - half, b.x0 + half, b.y1 + half);
        mark(i, b.x1 - half, b.y0 - half, b.x1 + half, b.y1 + half);
      } else {
        mark(i, b.x0 - half, b.y0 - half, b.x1 + half, b.y1 + half);
      }
    });
    var groups = {};
    paths.forEach(function (pt, i) {
      if (!keep[i]) return;
      var r = find(i);
      (groups[r] = groups[r] || []).push(pt);
    });
    Object.keys(groups).forEach(function (k) {
      var d = describeDrawing(groups[k], W, H);
      if (d) out.drawings.push(d);
    });
    out.drawings.sort(function (a, b) { return (a.box.y0 - b.box.y0) || (a.box.x0 - b.box.x0); });
    return out;
  }

  function topColours(tally, n) {
    return Object.keys(tally).map(function (h) { return { hex: h, n: tally[h] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, n || 8);
  }

  function describeDrawing(list, W, H) {
    var box = null, fills = 0, strokes = 0, rects = 0, fillT = {}, strokeT = {}, layer = null, layerMixed = false;
    var vx = [], hy = [], vl = [], hl = [], rx = [], ry = [], rw = [], rh = [];
    list.forEach(function (pt) {
      box = vUnion(box, pt.vbox);
      if (pt.fill) { fills++; fillT[pt.fill] = (fillT[pt.fill] || 0) + 1; }
      if (pt.stroke) { strokes++; strokeT[pt.stroke] = (strokeT[pt.stroke] || 0) + 1; }
      if (pt.rect) {
        rects++;
        rx.push(pt.vbox.x0); ry.push(pt.vbox.y0); rw.push(pt.vbox.x1 - pt.vbox.x0); rh.push(pt.vbox.y1 - pt.vbox.y0);
      }
      if (pt.vsegs) {
        for (var i = 0; i + 1 < pt.vsegs.vx.length; i += 2) { vx.push(pt.vsegs.vx[i]); vl.push(pt.vsegs.vx[i + 1]); }
        for (i = 0; i + 1 < pt.vsegs.hy.length; i += 2) { hy.push(pt.vsegs.hy[i]); hl.push(pt.vsegs.hy[i + 1]); }
        for (i = 0; i + 3 < pt.vsegs.rects.length; i += 4) {
          var w = pt.vsegs.rects[i + 2] - pt.vsegs.rects[i], h = pt.vsegs.rects[i + 3] - pt.vsegs.rects[i + 1];
          if (w < 1.2 && h > 2) { vx.push((pt.vsegs.rects[i] + pt.vsegs.rects[i + 2]) / 2); vl.push(h); }
          else if (h < 1.2 && w > 2) { hy.push((pt.vsegs.rects[i + 1] + pt.vsegs.rects[i + 3]) / 2); hl.push(w); }
          else if (w > 1.5 && h > 1.5 && list.length < 4) { rx.push(pt.vsegs.rects[i]); ry.push(pt.vsegs.rects[i + 1]); rw.push(w); rh.push(h); }
        }
      }
      if (layer === null) layer = pt.layer || null;
      else if (pt.layer !== layer) layerMixed = true;
    });
    if (!box) return null;
    var bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    var kind = 'figure', grid = null;
    // grid lines: many vertical and horizontal segments on one pitch each;
    // filled cells: many squares of one size on a lattice
    // grid lines are the long ones: a tick or a centre arrow beside the
    // grid is not one of them (a grid drawn cell edge by cell edge keeps all)
    var longOnly = function (pos, len) {
      var mx = 0, i2, keep = [];
      for (i2 = 0; i2 < len.length; i2++) if (len[i2] > mx) mx = len[i2];
      for (i2 = 0; i2 < pos.length; i2++) if (len[i2] >= mx * 0.5) keep.push(pos[i2]);
      return keep.length >= PERIOD_MIN_LINES ? keep : pos;
    };
    var px = periodOf(longOnly(vx, vl), 1.5), py = periodOf(longOnly(hy, hl), 1.5);
    var cellsMode = false;
    if (!(px && py) && rx.length >= 40) {
      // filled cells: the commonest cell size is the pitch, and most cells
      // start on one phase of it (runs of one colour merged into one wider
      // fill still start on the lattice)
      var mw = modeOf(rw, 0.05), mh = modeOf(rh, 0.05);
      if (mw > 1 && mh > 1) {
        px = latticeOf(rx, mw);
        py = latticeOf(ry, mh);
        cellsMode = true;
      }
    }
    if (px && py && px.count >= PERIOD_MIN_LINES && py.count >= PERIOD_MIN_LINES) {
      kind = 'grid';
      grid = { cols: Math.round((px.max - px.min) / px.pitch) + (cellsMode ? 1 : 0),
        rows: Math.round((py.max - py.min) / py.pitch) + (cellsMode ? 1 : 0),
        pitchX: r2(px.pitch), pitchY: r2(py.pitch), x0: r2(px.min), y0: r2(py.min), drawn: cellsMode ? 'cells' : 'lines' };
      if (grid.cols < 2 || grid.rows < 2) { kind = 'figure'; grid = null; }
    }
    if (kind === 'figure') {
      var thin = Math.min(bw, bh), long = Math.max(bw, bh);
      var fillKeys = Object.keys(fillT);
      if (thin <= 3 && long >= 12 && list.length <= 4) kind = 'rule';
      else if (list.length <= 3 && rects === list.length && fills === list.length && !strokes &&
        fillKeys.length === 1 && fillKeys[0] !== '#ffffff' && bw >= 10 && bh >= 10 && bw <= W * 0.4 && bh <= H * 0.4 &&
        bw / bh >= 0.25 && bw / bh <= 4) kind = 'swatch';
      else if (list.length <= 2 && rects === list.length) kind = 'box';
    }
    return {
      box: { x0: r2(box.x0), y0: r2(box.y0), x1: r2(box.x1), y1: r2(box.y1) },
      nbox: normBox(box, W, H),
      paths: list.length, fills: fills, strokes: strokes, rects: rects,
      fillColours: topColours(fillT), strokeColours: topColours(strokeT),
      kind: kind, grid: grid, layer: layerMixed ? null : layer
    };
  }

  /** The commonest value, binned at `bin`. */
  function modeOf(a, bin) {
    var t = {}, best = 0, bestN = 0;
    a.forEach(function (v) {
      var k = Math.round(v / bin);
      t[k] = (t[k] || 0) + 1;
      if (t[k] > bestN) { bestN = t[k]; best = k; }
    });
    return best * bin;
  }

  /**
   * Positions on a lattice of about `pitch`: the phase most of them share
   * (in tenths of the pitch) and, among those, the pitch refined from the
   * span. -> {pitch, count, min, max, share} or null (under half on phase).
   */
  function latticeOf(pos, pitch) {
    if (!pos || pos.length < PERIOD_MIN_LINES || !(pitch > 0)) return null;
    var bins = new Array(10), i;
    for (i = 0; i < 10; i++) bins[i] = 0;
    var ref = Infinity;
    for (i = 0; i < pos.length; i++) if (pos[i] < ref) ref = pos[i];
    // the cell size only says the pitch to about 1%, which drifts a whole
    // cell over a hundred rows: try pitches around it and keep the one the
    // positions agree on best (the length of their mean phase vector)
    var step = Math.max(1, Math.floor(pos.length / 4000)), bestR = -1, bestP = pitch;
    for (var t = -30; t <= 30; t++) {
      var p = pitch * (1 + t * 0.0015), sc = 0, ss = 0, n = 0;
      for (i = 0; i < pos.length; i += step) {
        var ang = 2 * Math.PI * (pos[i] - ref) / p;
        sc += Math.cos(ang); ss += Math.sin(ang); n++;
      }
      var R = Math.sqrt(sc * sc + ss * ss) / n;
      if (R > bestR) { bestR = R; bestP = p; }
    }
    pitch = bestP;
    pos.forEach(function (v) {
      var f = ((v - ref) / pitch) % 1;
      bins[Math.floor(f * 10) % 10]++;
    });
    var bi = 0, bn = -1;
    for (i = 0; i < 10; i++) {
      var n = bins[i] + bins[(i + 9) % 10] + bins[(i + 1) % 10];
      if (n > bn) { bn = n; bi = i; }
    }
    if (bn < pos.length * 0.5) return null;
    var on = pos.filter(function (v) {
      var f = ((v - ref) / pitch) % 1;
      var d = Math.abs(f - (bi + 0.5) / 10);
      return Math.min(d, 1 - d) <= 0.15;
    });
    var u = [];
    on.sort(function (a, b) { return a - b; }).forEach(function (v) {
      if (!u.length || v - u[u.length - 1] > pitch * 0.3) u.push(v);
    });
    if (u.length < PERIOD_MIN_LINES) return null;
    var lo = u[0], hi = u[u.length - 1];
    var steps = Math.round((hi - lo) / pitch);
    return { pitch: steps > 0 ? (hi - lo) / steps : pitch, count: u.length, min: lo, max: hi, share: r2(bn / pos.length) };
  }

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.floor(s.length / 2)];
  }

  /**
   * "Figure 3" / "Fig. 3" / "Diagram B" lines, each joined to the nearest
   * picture or drawing: one above or below it that it overlaps across, or
   * that it sits inside; failing that the nearest by edge distance.
   */
  function captions(lines, images, drawings, W, H) {
    var out = [], pairs = [];
    var targets = [];
    images.forEach(function (im, i) {
      var side = Math.min(im.box.x1 - im.box.x0, im.box.y1 - im.box.y0);
      // a strip down the page edge (a border, a tab) is nobody's figure
      if (side >= 20 && vArea(im.box) >= W * H * 0.004 && vArea(im.box) < W * H * BACKGROUND_SHARE) targets.push({ type: 'image', index: i, box: im.box });
    });
    drawings.forEach(function (d, i) {
      if (d.kind !== 'rule' && vArea(d.box) >= W * H * 0.003) targets.push({ type: 'drawing', index: i, box: d.box });
    });
    lines.forEach(function (l) {
      var text = String(l.text || '').trim();
      if (!text || text.length > CAPTION_MAX_CHARS || !l.box) return;
      var m = CAPTION_RE.exec(text);
      if (!m) return;
      var word = m[1].toLowerCase();
      var ref = (/^fig/.test(word) ? 'Figure' : /^diag/.test(word) ? 'Diagram' : /^illus/.test(word) ? 'Illustration'
        : word.charAt(0).toUpperCase() + word.slice(1)) + ' ' + m[2];
      var b = l.box;
      var lh = Math.max(4, b.y1 - b.y0);
      targets.forEach(function (t) {
        var tb = t.box;
        var ox = Math.min(b.x1, tb.x1) - Math.max(b.x0, tb.x0);
        var oy = Math.min(b.y1, tb.y1) - Math.max(b.y0, tb.y0);
        var gx = Math.max(0, Math.max(b.x0, tb.x0) - Math.min(b.x1, tb.x1));
        var gy = Math.max(0, Math.max(b.y0, tb.y0) - Math.min(b.y1, tb.y1));
        var gap, score;
        if (ox > 0 && oy > 0) { gap = 0; score = 0; }                      // inside or across it
        else if (ox >= Math.min(b.x1 - b.x0, tb.x1 - tb.x0) * 0.3) { gap = gy; score = gy; }   // above or below
        else if (oy > 0) { gap = gx; score = gx * 1.5; }                     // beside
        else { gap = Math.sqrt(gx * gx + gy * gy); score = gap * 2; }
        if (score <= Math.max(H * 0.12, lh * 6)) pairs.push({ c: out.length, t: t, gap: gap, score: score });
      });
      out.push({ text: text, line: l.i == null ? null : l.i, box: b, ref: ref, label: m[2], target: null, gap: null });
    });
    // one caption per picture and one picture per caption, nearest first
    pairs.sort(function (a, b) { return a.score - b.score; });
    var takenT = {};
    pairs.forEach(function (p) {
      var key = p.t.type + p.t.index;
      if (out[p.c].target || takenT[key]) return;
      takenT[key] = true;
      out[p.c].target = { type: p.t.type, index: p.t.index };
      out[p.c].gap = r2(p.gap);
    });
    return out;
  }

  /* ---- Page kind hints ------------------------------------------------- */
  var KEY_WORD_RE = /\b(?:key|legend|floss|colou?rs? used|symbols?|thread list|dmc|anchor|skeins?)\b/i;
  var CODE_RE = /^(?:[A-Z]{0,3}\s?)?\d{2,4}[A-Z]?$|^(?:B5200|blanc|ecru|white)$/i;
  var SHEET_TILE_RE = /^\d{1,2}\s?[A-Za-z]$|^[A-Za-z]\s?\d{1,2}$/;
  var SHEET_WORD_RE = /\b(?:grainline|place on fold|cut \d+|fold line|notch|seam allowance|test square|pattern piece)\b/i;
  var LAYOUT_WORD_RE = /^\s*(?:(?:quilt (?:layout|assembly|diagram|top)|layout diagram|assembly diagram|block layout)\b|row \d+\s*$)/i;
  var PROSE_LINE_WORDS = 7;

  /**
   * A guess at what a page is, with the reasons, from a layout. `pageNo` and
   * `chart` (a glyph lattice from glyphGrid, or null) sharpen it.
   * -> {guess, confidence, reasons, scores}
   */
  function pageKind(lay) {
    var W = lay.width, H = lay.height, A = W * H || 1;
    var lines = lay.lines || [], images = lay.images || [], drawings = lay.drawings || [];
    var scores = { chart: 0, key: 0, photo: 0, instructions: 0, sheet: 0, layout: 0, cover: 0, blank: 0 };
    var reasons = { chart: [], key: [], photo: [], instructions: [], sheet: [], layout: [], cover: [], blank: [] };
    var say = function (k, s, why) { scores[k] += s; reasons[k].push(why); };
    var words = 0, prose = 0, codes = 0, keyWords = 0, tiles = 0, sheetWords = 0, layoutWords = 0, maxSize = 0, sizes = [];
    lines.forEach(function (l) {
      var t = String(l.text || '');
      var w = t.split(/\s+/).filter(Boolean);
      words += w.length;
      if (w.length >= PROSE_LINE_WORDS && /[a-z]{3,}/.test(t)) prose++;
      w.forEach(function (x) { if (CODE_RE.test(x)) codes++; });
      if (KEY_WORD_RE.test(t)) keyWords++;
      if (SHEET_TILE_RE.test(t.trim())) tiles++;
      if (SHEET_WORD_RE.test(t)) sheetWords++;
      if (LAYOUT_WORD_RE.test(t)) layoutWords++;
      if (l.size > maxSize) maxSize = l.size;
      if (l.size > 0) sizes.push(l.size);
    });
    var body = median(sizes) || 10;
    var imgA = 0, bigImg = 0, clippedImgs = 0, smallImgs = 0;
    images.forEach(function (im) {
      var a = vArea(im.box);
      if (a > bigImg) bigImg = a;
      imgA += a;
      if (im.clipped) clippedImgs++;
      if (a < A * 0.05 && a > A * 0.002) smallImgs++;
    });
    var gridA = 0, tableA = 0, figA = 0, swatches = 0, fillsN = 0, strokeOnlyA = 0, squarish = 0;
    images.forEach(function (im) {
      var w = im.box.x1 - im.box.x0, h = im.box.y1 - im.box.y0;
      if (w >= 24 && h >= 24 && w <= W * 0.3 && h <= H * 0.3 && w / h > 0.6 && w / h < 1.65) squarish++;
    });
    drawings.forEach(function (d) {
      var a = vArea(d.box);
      // a chart's cells are small and many; a ruled table (a size chart,
      // a quilt's block grid) has big cells
      if (d.kind === 'grid' && d.grid && d.grid.pitchX <= 14 && d.grid.pitchY <= 14 && d.grid.cols >= 10 && d.grid.rows >= 10) gridA = Math.max(gridA, a);
      else if (d.kind === 'grid') tableA = Math.max(tableA, a);
      if (d.kind === 'figure') figA += a;
      if (d.kind === 'swatch') swatches++;
      fillsN += d.fills;
      if (!d.fills && d.strokes) strokeOnlyA += a;
    });
    var chart = lay.chart;
    if (!lines.length && !images.length && !drawings.length) say('blank', 1, 'nothing on the page');
    if (chart && chart.cells >= 100) say('chart', Math.min(1, 0.5 + chart.cells / 2000), 'a lattice of ' + chart.cols + ' x ' + chart.rows + ' symbols set in a font');
    if (gridA >= A * 0.12) say('chart', Math.min(1, 0.4 + gridA / A), 'a ruled grid over ' + Math.round(gridA / A * 100) + '% of the page');
    if (fillsN >= 800) say('chart', 0.35, fillsN + ' filled shapes');
    if (bigImg >= A * 0.35) say('photo', 0.5 + Math.min(0.4, bigImg / A - 0.35), 'one picture covers ' + Math.round(bigImg / A * 100) + '% of the page');
    if (bigImg >= A * 0.35 && words < 60) say('photo', 0.2, 'little text (' + words + ' words)');
    if (prose >= 8) say('instructions', Math.min(1, 0.3 + prose / 40), prose + ' lines of running text');
    if (keyWords && codes >= 6) say('key', Math.min(1, 0.35 + codes / 60), codes + ' colour codes beside "' + 'key' + '" words');
    else if (codes >= 15 && prose < 8 && !tableA) say('key', 0.2, codes + ' code-like numbers');
    if (swatches >= 4 || (smallImgs >= 6 && codes >= 4)) say('key', 0.25, (swatches || smallImgs) + ' small swatches');
    if (squarish >= 8 && !layoutWords) say('key', 0.35, squarish + ' square pictures (fabric or colour swatches)');
    if (tableA >= A * 0.1) say('instructions', 0.2, 'a ruled table');
    if (layoutWords && (tableA || gridA)) say('layout', 0.3, 'a grid of blocks');
    if (tiles >= 1 && strokeOnlyA >= A * 0.2) say('sheet', 0.5, 'tile labels and line drawings');
    if (sheetWords) say('sheet', Math.min(0.5, 0.2 * sheetWords), sheetWords + ' pattern-piece words');
    if (W > 1500 || H > 1500) say('sheet', 0.4, 'a large sheet (' + Math.round(W / 72 * 25.4) + ' x ' + Math.round(H / 72 * 25.4) + ' mm)');
    if (strokeOnlyA >= A * 0.45 && prose < 4) say('sheet', 0.25, 'mostly outline drawing');
    if (layoutWords) say('layout', Math.min(0.6, 0.3 * layoutWords), 'layout words');
    if (layoutWords && (clippedImgs >= 8 || figA >= A * 0.25)) say('layout', 0.35, (clippedImgs >= 8 ? clippedImgs + ' clipped fabric pictures' : 'a large figure'));
    if (lay.page === 1) {
      if (bigImg >= A * 0.2) say('cover', 0.45, 'first page with a big picture');
      if (maxSize >= body * 2.2 && lines.length <= 30) say('cover', 0.3, 'a big title');
      if (prose < 6) say('cover', 0.1, 'little running text');
    }
    if (prose >= 8 && scores.photo) scores.photo *= 0.5;
    var order = Object.keys(scores).sort(function (a, b) { return scores[b] - scores[a]; });
    var top = order[0], second = order[1];
    if (!(scores[top] > 0)) {
      return { guess: words ? 'instructions' : 'blank', confidence: 0.2, reasons: [words ? 'some text, nothing else stands out' : 'nothing stands out'], scores: scores };
    }
    var conf = Math.max(0.05, Math.min(0.95, scores[top] / (scores[top] + scores[second] + 0.25)));
    Object.keys(scores).forEach(function (k) { scores[k] = r2(Math.min(1, scores[k])); });
    return { guess: top, confidence: r2(conf), reasons: reasons[top], scores: scores };
  }

  /* ---- Symbol fonts ------------------------------------------------------ */
  /** Fonts whose runs are symbols one to a cell ("O O O", "2 2 2 2"). */
  function chartFonts(glyphs, minGlyphs) {
    var t = {};
    var runs = {};
    glyphs.forEach(function (g) {
      if (g.invisible) return;
      var key = g.font + '#' + g.run;
      var r = runs[key] || (runs[key] = { font: g.font, s: '' });
      r.s += g.space || g.unicode === ' ' ? ' ' : (g.unicode || '?');
    });
    Object.keys(runs).forEach(function (k) {
      var r = runs[k], f = t[r.font] || (t[r.font] = { single: 0, other: 0 });
      r.s.split(/\s+/).forEach(function (w) {
        if (!w) return;
        if (w.length === 1) f.single++;
        else if (/^(.)\1+$/.test(w) || !/[A-Za-z0-9]{2}/.test(w)) f.single += w.length;   // "OOO" touching cells
        else f.other += w.length;
      });
    });
    var out = [];
    for (var f in t) {
      var all = t[f].single + t[f].other;
      if (all < (minGlyphs || 30)) continue;
      if (t[f].single >= all * 0.85) { out.push(f); continue; }
      // or its glyphs stand on a lattice of their own ("8O8p" touching)
      var bx = [], by = [], sz = [];
      glyphs.forEach(function (g) {
        var b = g.vbox || g.box;
        if (g.font !== f || g.space || g.invisible || !b) return;
        bx.push((b.x0 + b.x1) / 2); by.push((b.y0 + b.y1) / 2); sz.push(g.size);
      });
      var s = median(sz) || 5;
      var lx = periodOf(bx, s * 0.3, s * 0.3), ly = periodOf(by, s * 0.3, s * 0.3);
      if (lx && ly && lx.count >= 8 && ly.count >= 8 && Math.abs(lx.pitch - ly.pitch) <= Math.max(lx.pitch, ly.pitch) * 0.25) out.push(f);
    }
    return out;
  }

  /**
   * Bucket glyphs (view-space boxes, `vbox`) into a lattice.
   * opts {fonts:[fontId], rect:{x0..}, sizeTol:0.2}
   * -> {cols, rows, pitchX, pitchY, x0, y0, cells, symbols:[{key, font, base, code,
   *     unicode, count}], grid:[[symbolIndex|-1]], fit, clashes} or null
   */
  function glyphGrid(glyphs, opts) {
    opts = opts || {};
    var fonts = opts.fonts || chartFonts(glyphs, 30);
    if (!fonts.length) return null;
    var want = {};
    fonts.forEach(function (f) { want[f] = true; });
    var rect = opts.rect || null;
    var gl = glyphs.filter(function (g) {
      if (!want[g.font] || g.space || g.invisible || !g.vbox || g.unicode === ' ') return false;
      if (!rect) return true;
      var cx = (g.vbox.x0 + g.vbox.x1) / 2, cy = (g.vbox.y0 + g.vbox.y1) / 2;
      return cx >= rect.x0 && cx <= rect.x1 && cy >= rect.y0 && cy <= rect.y1;
    });
    if (gl.length < 4) return null;
    var size = median(gl.map(function (g) { return g.size; }));
    var tol = opts.sizeTol || 0.2;
    gl = gl.filter(function (g) { return Math.abs(g.size - size) <= size * tol; });
    var cx = gl.map(function (g) { return (g.vbox.x0 + g.vbox.x1) / 2; });
    var cy = gl.map(function (g) { return (g.vbox.y0 + g.vbox.y1) / 2; });
    var jit = size * 0.3;
    var px = periodOf(cx, size * 0.3, jit), py = periodOf(cy, size * 0.3, jit);
    // a font set off the cell centres (quarter stitches in a corner) can
    // break the lattice for all: take the pitch from the biggest font
    // that has one, then place every glyph against it
    if (!px || !py) {
      var by = {};
      gl.forEach(function (g, i) { (by[g.font] = by[g.font] || []).push(i); });
      Object.keys(by).sort(function (a, b) { return by[b].length - by[a].length; }).some(function (f) {
        var ix = by[f];
        if (ix.length < 20) return false;
        var fx = periodOf(ix.map(function (i) { return cx[i]; }), size * 0.3, jit);
        var fy = periodOf(ix.map(function (i) { return cy[i]; }), size * 0.3, jit);
        if (!px && fx) px = fx;
        if (!py && fy) py = fy;
        return px && py;
      });
    }
    if (!px || !py) return null;
    // the lattice's phase is the median offset of every glyph from it,
    // and its first line sits at or before the first glyph
    var phase = function (vals, per) {
      var off = vals.map(function (v) { var f = (v - per.min) / per.pitch; return f - Math.round(f); }).sort(function (a, b) { return a - b; });
      var o = per.min + off[Math.floor(off.length / 2)] * per.pitch;
      var lo = Infinity, hi = -Infinity;
      for (var q = 0; q < vals.length; q++) { if (vals[q] < lo) lo = vals[q]; if (vals[q] > hi) hi = vals[q]; }
      o -= Math.ceil((o - lo) / per.pitch - 0.5) * per.pitch;
      return { pitch: per.pitch, min: o, max: o + Math.round((hi - o) / per.pitch) * per.pitch };
    };
    px = phase(cx, px);
    py = phase(cy, py);
    var cols = Math.round((px.max - px.min) / px.pitch) + 1, rows = Math.round((py.max - py.min) / py.pitch) + 1;
    if (cols * rows > 4000000) return null;
    var symbols = [], symAt = {}, grid = [], r, c;
    for (r = 0; r < rows; r++) { var row = new Array(cols); for (c = 0; c < cols; c++) row[c] = -1; grid.push(row); }
    var fit = 0, clashes = 0, cells = 0, offCell = 0;
    for (var i = 0; i < gl.length; i++) {
      var fc = (cx[i] - px.min) / px.pitch, fr = (cy[i] - py.min) / py.pitch;
      c = Math.round(fc); r = Math.round(fr);
      if (Math.abs(fc - c) <= 0.2 && Math.abs(fr - r) <= 0.2) fit++;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      if (Math.abs(fc - c) > 0.35 || Math.abs(fr - r) > 0.35) { offCell++; continue; }   // between cells: not a whole stitch
      var g = gl[i];
      var key = (g.base || g.font) + ':' + g.code;
      var si = symAt[key];
      if (si === undefined) {
        si = symAt[key] = symbols.length;
        symbols.push({ key: key, font: g.font, base: g.base || '', code: g.code, unicode: g.unicode, count: 0 });
      }
      if (grid[r][c] >= 0) { if (grid[r][c] !== si) clashes++; continue; }
      grid[r][c] = si;
      symbols[si].count++;
      cells++;
    }
    return { cols: cols, rows: rows, pitchX: r2(px.pitch), pitchY: r2(py.pitch), x0: r2(px.min), y0: r2(py.min),
      cells: cells, symbols: symbols, grid: grid, fit: r2(fit / gl.length), clashes: clashes, offCell: offCell, fonts: fonts };
  }

  /* ---- Painting probe ---------------------------------------------------- */
  var paintProbe = null;      // {at, ok}
  /** Does this tab paint frames? A hidden pane never fires rAF. -> Promise<boolean> */
  function canPaint() {
    var now = Date.now();
    if (paintProbe && now - paintProbe.at < 1500) return Promise.resolve(paintProbe.ok);
    if (typeof window.requestAnimationFrame !== 'function') return Promise.resolve(false);
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (ok) {
        if (done) return;
        done = true;
        paintProbe = { at: Date.now(), ok: ok };
        resolve(ok);
      };
      try { window.requestAnimationFrame(function () { finish(true); }); } catch (e) { finish(false); }
      setTimeout(function () { finish(false); }, 250);
    });
  }

  /** Pieces of text a wide gap apart on one baseline ("Fig. 2      Fig. 2"
   * under two drawings is two captions), with their PDF-space boxes. */
  var SEGMENT_GAP = 1.5;      // a gap this many heights wide splits a line
  function segmentsOf(items, rotate) {
    var rows = buildRows(items, rotate), out = [];
    rows.forEach(function (row) {
      var cur = null;
      row.items.forEach(function (it) {
        if (!it.box) return;
        // the same words printed again over themselves (a second layout
        // layer, faux bold) are one caption, not two run together
        if (cur && it.x < cur.end && cur.text.indexOf(String(it.str).trim()) >= 0 &&
            Math.min(cur.end, it.end) - Math.max(cur.x0, it.x) >= (it.end - it.x) * 0.5) return;
        var gap = cur ? it.x - cur.end : 0;
        if (!cur || gap > Math.max(it.h, cur.h) * SEGMENT_GAP) {
          if (cur) out.push(cur);
          cur = { text: '', box: it.box.slice(), end: it.end, h: it.h, x0: it.x };
        }
        cur.text += (cur.text && gap > it.h * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
        cur.box = [Math.min(cur.box[0], it.box[0]), Math.min(cur.box[1], it.box[1]), Math.max(cur.box[2], it.box[2]), Math.max(cur.box[3], it.box[3])];
        cur.end = Math.max(cur.end, it.end);
        cur.h = Math.max(cur.h, it.h);
      });
      if (cur) out.push(cur);
    });
    return out;
  }

  /** Caption candidates: the pieces that start like a caption, each with
   * its view box and the layout line it belongs to (`i`). */
  function captionPieces(items, rotate, vt, lines) {
    var out = [];
    var pieces = [];
    segmentsOf(items, rotate).forEach(function (s) {
      var text = normUnicode(String(s.text || '')).trim();
      if (!CAPTION_RE.test(text)) return;
      // "Fig. 2 Fig. 2" set as one run: one caption per drawing, the box
      // shared out by characters
      var cuts = [0], m;
      CAPTION_AGAIN_RE.lastIndex = 0;
      while ((m = CAPTION_AGAIN_RE.exec(text))) cuts.push(m.index + 1);
      if (cuts.length === 1) { pieces.push({ text: text, box: s.box }); return; }
      var b = s.box, wide = b[2] - b[0] >= b[3] - b[1];
      cuts.push(text.length);
      for (var c = 0; c + 1 < cuts.length; c++) {
        var f0 = cuts[c] / text.length, f1 = cuts[c + 1] / text.length;
        var sub = wide ? [b[0] + (b[2] - b[0]) * f0, b[1], b[0] + (b[2] - b[0]) * f1, b[3]]
          : [b[0], b[1] + (b[3] - b[1]) * f0, b[2], b[1] + (b[3] - b[1]) * f1];
        pieces.push({ text: text.slice(cuts[c], cuts[c + 1]).trim(), box: sub });
      }
    });
    pieces.forEach(function (s) {
      var text = s.text;
      var box = toViewBox(vt, s.box);
      for (var d = 0; d < out.length; d++) {
        if (out[d].text === text && vArea(vCut(out[d].box, box)) > 0) return;    // printed twice in one place
      }
      var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, li = null;
      for (var k = 0; k < lines.length; k++) {
        var b = lines[k].box;
        if (b && cx >= b.x0 - 1 && cx <= b.x1 + 1 && cy >= b.y0 - 1 && cy <= b.y1 + 1) { li = k; break; }
      }
      out.push({ text: text, box: box, i: li });
    });
    return out;
  }

  /** Yield to the page once. A message, not a timer: timers in a hidden
   * tab are held back to one a second (or a minute), messages are not. */
  function pause() {
    return new Promise(function (resolve) {
      if (typeof MessageChannel === 'function') {
        var ch = new MessageChannel();
        ch.port1.onmessage = function () { ch.port1.close(); resolve(); };
        ch.port2.postMessage(0);
      } else setTimeout(resolve, 0);
    });
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function namedError(name, message) {
    var e = new Error(message);
    e.name = name;
    return e;
  }

  /**
   * Add the wave K calls to an open handle. `ctx` = {doc, guard, stopped,
   * caseState}: guard(callSignal) -> Error|null as in open().
   */
  function addStructure(handle, ctx) {
    var doc = ctx.doc;
    var cache = [];                 // [{n, glyphs, lay}] newest last
    var fontChars = {};             // fontId -> code -> fontChar (for renderGlyph)
    var ocPromise = null;

    var cached = function (n, glyphs) {
      for (var i = cache.length - 1; i >= 0; i--) {
        if (cache[i].n === n && (!glyphs || cache[i].glyphs)) return cache[i].lay;
      }
      return null;
    };
    var remember = function (n, glyphs, lay) {
      cache = cache.filter(function (c) { return c.n !== n; });
      cache.push({ n: n, glyphs: glyphs, lay: lay });
      while (cache.length > LAYOUT_CACHE) cache.shift();
    };
    var pageNo = function (n) {
      n = parseInt(n, 10);
      return isFinite(n) && n >= 1 && n <= (doc.numPages || 0) ? n : 0;
    };
    var fontInfo = function (page, id) {
      var fo = null;
      try { if (page.commonObjs.has(id)) fo = page.commonObjs.get(id); } catch (e) { fo = null; }
      if (!fo) return { id: id, name: '', base: '', embedded: null, type3: false, hasToUnicode: null };
      return {
        id: id, name: fo.name || '', base: baseFontName(fo.name), embedded: !fo.missingFile,
        type3: !!fo.isType3Font, hasToUnicode: !!(fo.toUnicode && fo.toUnicode._map && Object.keys(fo.toUnicode._map).length),
        symbolic: /symbol|dingbat|wingding|webding|ursa|pattern ?maker|cross ?stitch|kg-?chart|zapf/i.test(fo.name || '')
      };
    };

    /** The full layout of page n. opts {signal, glyphs, graphics} */
    function layout(n, opts) {
      opts = opts || {};
      var stop = ctx.guard(opts.signal);
      if (stop) return Promise.reject(stop);
      var p = pageNo(n);
      if (!p) return Promise.reject(new Error('No page ' + n + ' in that PDF.'));
      var wantGlyphs = !!opts.glyphs;
      var graphics = opts.graphics !== false;
      var hit = graphics ? cached(p, wantGlyphs) : null;
      if (hit) return Promise.resolve(hit);
      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      return doc.getPage(p).then(function (page) {
        var mid = ctx.guard(opts.signal);
        if (mid) throw mid;
        var OPS = window.pdfjsLib && window.pdfjsLib.OPS;
        return visibleItems(page, null, ctx.caseState).then(function (vis) {
          var size = pageSize(page);
          var vp = page.getViewport({ scale: 1 });
          var vt = vp.transform, W = vp.width, H = vp.height;
          var tA = nowMs();
          var res = pageLines(vis.items, size.width, size.height, page.rotate);
          var textMs = nowMs() - tA;
          var olP = graphics && OPS ? page.getOperatorList() : Promise.resolve(null);
          return olP.then(function (ol) {
            var after = ctx.guard(opts.signal);
            if (after) throw after;
            var tB = nowMs();
            var gr = ol ? pageGraphics(ol, OPS, { glyphs: true }) : { images: [], paths: [], glyphs: [], layers: [], ops: 0, segments: 0 };
            var walkMs = nowMs() - tB;
            // let the page breathe between the walk and the region pass (a big
            // chart page is two pieces of work of a few hundred ms on a phone)
            return pause().then(function () {
            var stopNow = ctx.guard(opts.signal);
            if (stopNow) throw stopNow;
            var tP = nowMs();
            var fonts = {};
            var info = function (id) {
              if (!id) return null;
              if (!fonts[id]) fonts[id] = fontInfo(page, id);
              return fonts[id];
            };
            var lines = attachedLines(p) || res.lines.map(function (l, i) {
              var g = l.geo || {};
              var box = toViewBox(vt, g.box);
              var fi = info(g.font);
              return { i: i, text: l.text, box: box, nbox: normBox(box, W, H), font: fi ? fi.base : '', fontId: g.font || '',
                size: r2(g.size || 0), col: g.col || 0, margin: !!l.margin };
            });
            var images = gr.images.map(function (im) {
              var box = toViewBox(vt, im.box);
              return { id: im.id, op: im.op, box: box, nbox: normBox(box, W, H), px: im.px, mask: im.mask, inline: im.inline,
                layer: im.layer, clipped: im.clipped, colour: im.colour };
            });
            gr.paths.forEach(function (pt) {
              pt.vbox = toViewBox(vt, pt.box);
              // grid segments into view space (an axis swap on a turned page)
              var vxs = [], hys = [];
              var turned = Math.abs(vt[1]) > Math.abs(vt[0]);
              // flat [position, length, ...]
              for (var k = 0; k + 2 < pt.vx.length; k += 3) {
                var q = applyM(vt, pt.vx[k], pt.vx[k + 1]);
                (turned ? hys : vxs).push(turned ? q[1] : q[0], pt.vx[k + 2] - pt.vx[k + 1]);
              }
              for (k = 0; k + 2 < pt.hy.length; k += 3) {
                var q2 = applyM(vt, pt.hy[k + 1], pt.hy[k]);
                (turned ? vxs : hys).push(turned ? q2[0] : q2[1], pt.hy[k + 2] - pt.hy[k + 1]);
              }
              var rs = [];
              for (k = 0; k + 3 < pt.rects.length; k += 4) {
                var rb = toViewBox(vt, [pt.rects[k], pt.rects[k + 1], pt.rects[k + 2], pt.rects[k + 3]]);
                rs.push(rb.x0, rb.y0, rb.x1, rb.y1);
              }
              pt.vsegs = { vx: vxs, hy: hys, rects: rs };
            });
            var tC = nowMs();
            var dr = drawingRegions(gr.paths, W, H);
            var regionMs = nowMs() - tC;
            var glyphs = gr.glyphs.map(function (g) {
              var box = toViewBox(vt, g.box);
              var fi = info(g.font);
              if (g.font && g.fontChar != null) {
                var fc = fontChars[g.font] || (fontChars[g.font] = {});
                if (!(g.code in fc)) fc[g.code] = g.fontChar;
              }
              return { font: g.font, base: fi ? fi.base : '', code: g.code, unicode: g.unicode, box: box, vbox: box,
                nbox: normBox(box, W, H), advance: r2(g.advance), size: r2(g.size), space: g.space, invisible: g.invisible,
                run: g.run, layer: g.layer };
            });
            var chart = glyphGrid(glyphs, {});
            var lay = {
              page: p, width: r2(W), height: r2(H), rotate: page.rotate || 0,
              lines: lines, images: images, drawings: dr.drawings, backgrounds: dr.backgrounds,
              captions: captions(captionPieces(vis.items, page.rotate, vt, lines), images, dr.drawings, W, H),
              layers: gr.layers,
              fonts: fonts,
              chart: chart ? { cols: chart.cols, rows: chart.rows, cells: chart.cells, pitchX: chart.pitchX, pitchY: chart.pitchY,
                fonts: chart.fonts, symbols: chart.symbols.length, fit: chart.fit } : null
            };
            lay.kind = pageKind(lay);
            glyphs.forEach(function (g) { delete g.vbox; });
            if (wantGlyphs) lay.glyphs = glyphs;
            var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            lay.stats = { ms: Math.round(t1 - t0), ops: gr.ops, items: vis.items.length, glyphs: gr.glyphs.length,
              paths: gr.paths.length, segments: gr.segments,
              // main-thread work only (ms also waits on the pdf.js worker)
              mainMs: Math.round(textMs + walkMs + (t1 - tP)), textMs: Math.round(textMs), walkMs: Math.round(walkMs), regionMs: Math.round(regionMs) };
            if (typeof page.cleanup === 'function') page.cleanup();
            if (graphics) remember(p, wantGlyphs, lay);
            return lay;
            });
          });
        });
      });
    }

    /* ---- OCR text for an image-only page (wave K, asked by ocr) -------- */
    var attached = ctx.attached || {};

    /** Copies of the OCR lines attached to page p, or null. */
    function attachedLines(p) {
      var a = attached[p];
      if (!a) return null;
      return a.map(function (l) {
        var o = {};
        for (var k in l) if (k !== 'pos' && k !== 'edge') o[k] = l[k];
        return o;
      });
    }

    /** Non-blank characters of page p's own text, furniture left out. */
    function realChars(p) {
      return doc.getPage(p).then(function (page) {
        return visibleItems(page, null, ctx.caseState).then(function (vis) {
          var size = pageSize(page);
          var res = pageLines(vis.items, size.width, size.height, page.rotate);
          if (typeof page.cleanup === 'function') page.cleanup();
          var n = 0;
          res.lines.forEach(function (l) { if (!l.margin) n += String(l.text || '').replace(INVISIBLE_RE, '').replace(/\s/g, '').length; });
          return { chars: n, width: size.width, height: size.height };
        });
      });
    }

    /**
     * Give page n the lines OCR read from its picture (Ocr.toTextItems).
     * Refused, never overwriting, when the page has real text of its own.
     * null or [] takes them off again. -> Promise<{ok, lines, reason}>
     */
    function setPageText(n, items, opts) {
      opts = opts || {};
      var stop = ctx.guard(opts.signal);
      if (stop) return Promise.reject(stop);
      var p = pageNo(n);
      if (!p) return Promise.reject(new Error('No page ' + n + ' in that PDF.'));
      cache = cache.filter(function (c) { return c.n !== p; });
      if (!items || !items.length) {
        var had = !!attached[p];
        delete attached[p];
        return Promise.resolve({ ok: true, lines: 0, cleared: had });
      }
      return realChars(p).then(function (rc) {
        if (rc.chars >= MIN_PAGE_CHARS) {
          return { ok: false, lines: 0, reason: 'That page already has its own text (' + rc.chars + ' characters); OCR lines are only for picture pages.' };
        }
        var vp = { width: rc.width, height: rc.height };
        var W = vp.width, H = vp.height;
        var lines = [];
        items.forEach(function (it) {
          var text = String(it && it.text != null ? it.text : '').replace(/\s+/g, ' ').trim();
          if (!text) return;
          var box = it.box || null, nb = it.nbox || null;
          if (!box && nb) box = { x0: nb.x0 * W, y0: nb.y0 * H, x1: nb.x1 * W, y1: nb.y1 * H };
          if (box && !nb) nb = normBox(box, W, H);
          var cy = nb ? (nb.y0 + nb.y1) / 2 : 0.5;
          var margin = it.margin != null ? !!it.margin : (cy <= MARGIN_BAND || cy >= 1 - MARGIN_BAND);
          var pos = nb ? 1 - nb.y1 : 0.5;                       // the baseline from the bottom, like pageLines
          lines.push({ i: lines.length, text: text, box: box, nbox: nb, font: 'ocr', fontId: null,
            size: it.size || (box ? r2(box.y1 - box.y0) : 0), col: 0, margin: margin, ocr: true,
            conf: it.conf == null ? null : it.conf, words: it.words || null,
            pos: pos, edge: Math.min(pos, 1 - pos) });
        });
        if (!lines.length) { delete attached[p]; return { ok: true, lines: 0 }; }
        attached[p] = lines;
        return { ok: true, lines: lines.length };
      });
    }

    /** Pages that carry OCR lines now, ascending. */
    function ocrPagesNow() {
      return Object.keys(attached).map(Number).sort(function (a, b) { return a - b; });
    }

    /** The text whose items' centres lie inside rect. */
    function textIn(n, rect, opts) {
      opts = opts || {};
      var stop = ctx.guard(opts.signal);
      if (stop) return Promise.reject(stop);
      var p = pageNo(n);
      if (!p) return Promise.resolve({ text: '', lines: [] });
      if (attached[p]) {
        return doc.getPage(p).then(function (page) {
          var vp0 = page.getViewport({ scale: 1 });
          var r = readRect(rect, vp0.width, vp0.height);
          var got = attachedLines(p).filter(function (l) {
            if (!l.box) return false;
            var cx = (l.box.x0 + l.box.x1) / 2, cy = (l.box.y0 + l.box.y1) / 2;
            return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
          });
          return { text: got.map(function (l) { return l.text; }).join('\n'), lines: got, ocr: true };
        });
      }
      return doc.getPage(p).then(function (page) {
        return visibleItems(page, null, ctx.caseState).then(function (vis) {
          var vp = page.getViewport({ scale: 1 });
          var vt = vp.transform, W = vp.width, H = vp.height;
          var r = readRect(rect, W, H);
          var inside = vis.items.filter(function (it) {
            if (!it || typeof it.str !== 'string' || !it.str.length || !it.transform) return false;
            var b = toViewBox(vt, itemBox(it, it.width || 0));
            if (!b) return false;
            var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
            return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
          });
          var rows = buildRows(inside, page.rotate);
          var deglyph = pageLooksSpaced(rows);
          var lines = [];
          rows.forEach(function (row) {
            var text = normUnicode(rowText(row, deglyph));
            if (!text) return;
            var g = rowGeo(row, 0);
            var box = toViewBox(vt, g && g.box);
            lines.push({ text: text, box: box, nbox: normBox(box, W, H), fontId: g ? g.font : '', size: r2(g ? g.size : 0) });
          });
          if (typeof page.cleanup === 'function') page.cleanup();
          return { text: lines.map(function (l) { return l.text; }).join('\n'), lines: lines };
        });
      });
    }

    function find(n, re, opts) {
      return layout(n, opts).then(function (lay) {
        var test = typeof re === 'string'
          ? function (t) { return t.toLowerCase().indexOf(re.toLowerCase()) >= 0; }
          : function (t) { re.lastIndex = 0; return re.test(t); };
        return lay.lines.filter(function (l) { return test(l.text); });
      });
    }

    function glyphsOf(n, opts) {
      opts = opts || {};
      return layout(n, { signal: opts.signal, glyphs: true }).then(function (lay) {
        var W = lay.width, H = lay.height;
        var rect = opts.rect ? readRect(opts.rect, W, H) : null;
        var want = null;
        if (opts.font) { want = {}; [].concat(opts.font).forEach(function (f) { want[f] = true; }); }
        var gl = lay.glyphs.filter(function (g) {
          if (want && !want[g.font] && !want[g.base]) return false;
          if (!rect || !g.box) return true;
          var cx = (g.box.x0 + g.box.x1) / 2, cy = (g.box.y0 + g.box.y1) / 2;
          return cx >= rect.x0 && cx <= rect.x1 && cy >= rect.y0 && cy <= rect.y1;
        });
        return { page: lay.page, width: W, height: H, fonts: lay.fonts, glyphs: gl, chartFonts: chartFonts(lay.glyphs, 30) };
      });
    }

    /** A lattice of symbol glyphs on page n (see glyphGrid). */
    function chartOf(n, opts) {
      opts = opts || {};
      return glyphsOf(n, { signal: opts.signal, rect: opts.rect }).then(function (g) {
        var withBox = g.glyphs.map(function (x) {
          var o = {};
          for (var k in x) o[k] = x[k];
          o.vbox = x.box;
          return o;
        });
        var res = glyphGrid(withBox, { fonts: opts.fonts });
        if (res) res.page = g.page;
        return res;
      });
    }

    /** One glyph of an embedded font, drawn to fit a px square. */
    function renderGlyph(fontId, code, opts) {
      opts = opts || {};
      var stop = ctx.guard(opts.signal);
      if (stop) return Promise.reject(stop);
      var px = Math.max(4, Math.min(256, opts.px || 24));
      var pad = Math.max(0, Math.min(px / 3, opts.pad == null ? 2 : opts.pad));
      var fc = fontChars[fontId] && fontChars[fontId][code];
      if (fc == null) return Promise.resolve(null);
      return doc.getPage(1).then(function (page) {
        var objs = page.commonObjs, fo = null;
        try { if (objs.has(fontId)) fo = objs.get(fontId); } catch (e) { fo = null; }
        if (!fo || fo.isType3Font || typeof fo.getPathGenerator !== 'function') return null;
        var gen = null;
        try {
          if (!objs.has(fo.loadedName + '_path_' + fc)) return null;
          gen = fo.getPathGenerator(objs, fc);
        } catch (e) { return null; }
        if (typeof document === 'undefined' || !gen) return null;
        var em = px * 2, S = em * 3;
        var big = document.createElement('canvas');
        big.width = S; big.height = S;
        var g = big.getContext('2d');
        if (!g) return null;
        g.save();
        g.translate(em, em * 2);
        g.beginPath();
        try { gen(g, em); } catch (e) { g.restore(); return null; }
        g.fillStyle = '#000';
        g.fill();
        g.restore();
        var d = g.getImageData(0, 0, S, S).data;
        var x0 = S, y0 = S, x1 = -1, y1 = -1;
        for (var y = 0; y < S; y++) {
          for (var x = 0; x < S; x++) {
            if (d[(y * S + x) * 4 + 3] > 24) {
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        var out = document.createElement('canvas');
        out.width = px; out.height = px;
        var o = out.getContext('2d');
        if (x1 < 0) { out.ink = null; return out; }       // a blank glyph (a space)
        var iw = x1 - x0 + 1, ih = y1 - y0 + 1;
        var k = Math.min((px - 2 * pad) / iw, (px - 2 * pad) / ih);
        if (opts.fit === false) k = Math.min(k, 0.5);   // keep the em scale (em = 2 px)
        var dw = iw * k, dh = ih * k;
        if (opts.colour) {
          o.fillStyle = opts.colour;
          o.fillRect(0, 0, px, px);
          o.globalCompositeOperation = 'destination-in';
        }
        o.drawImage(big, x0, y0, iw, ih, (px - dw) / 2, (px - dh) / 2, dw, dh);
        o.globalCompositeOperation = 'source-over';
        out.ink = { x0: r4((x0 - em) / em), y0: r4((em * 2 - y1 - 1) / em), x1: r4((x1 + 1 - em) / em), y1: r4((em * 2 - y0) / em) };
        big.width = 0; big.height = 0;
        return out;
      });
    }

    function ocConfig() {
      if (!ocPromise) {
        ocPromise = typeof doc.getOptionalContentConfig === 'function'
          ? doc.getOptionalContentConfig().then(null, function () { return null; })
          : Promise.resolve(null);
      }
      return ocPromise;
    }

    function layersOf() {
      var stop = ctx.guard();
      if (stop) return Promise.reject(stop);
      return ocConfig().then(function (cfg) {
        var groups = cfg && typeof cfg.getGroups === 'function' ? cfg.getGroups() : null;
        var list = [];
        if (groups) {
          Object.keys(groups).forEach(function (id) {
            var g = groups[id];
            list.push({ id: id, name: g.name || '', visible: g.visible !== false, intent: g.intent || null });
          });
        }
        var order = cfg && typeof cfg.getOrder === 'function' ? cfg.getOrder() : null;
        return { none: !list.length, layers: list, order: order || [] };
      });
    }

    /** A fresh config with `spec` applied, or null for the default. */
    function layerConfig(spec) {
      if (!spec || typeof doc.getOptionalContentConfig !== 'function') return Promise.resolve(null);
      return doc.getOptionalContentConfig().then(function (cfg) {
        var groups = cfg && cfg.getGroups ? cfg.getGroups() : null;
        if (!groups) return { cfg: null, unknown: [].concat(spec.on || [], spec.off || [], spec.only || []) };
        var ids = Object.keys(groups), unknown = [];
        var resolve = function (want) {
          var hit = ids.filter(function (id) { return id === want || groups[id].name === want; });
          if (!hit.length) {
            var low = String(want).toLowerCase();
            hit = ids.filter(function (id) { return String(groups[id].name || '').toLowerCase() === low; });
          }
          if (!hit.length) unknown.push(want);
          return hit;
        };
        if (spec.only) {
          var keep = {};
          [].concat(spec.only).forEach(function (w) { resolve(w).forEach(function (id) { keep[id] = true; }); });
          ids.forEach(function (id) { cfg.setVisibility(id, !!keep[id]); });
        }
        [].concat(spec.on || []).forEach(function (w) { resolve(w).forEach(function (id) { cfg.setVisibility(id, true); }); });
        [].concat(spec.off || []).forEach(function (w) { resolve(w).forEach(function (id) { cfg.setVisibility(id, false); }); });
        return { cfg: cfg, unknown: unknown };
      });
    }

    /** Draw `rect` of page n. See the API file for opts. */
    function renderRegion(n, rect, opts) {
      opts = opts || {};
      var stop = ctx.guard(opts.signal);
      if (stop) return Promise.reject(stop);
      var p = pageNo(n);
      if (!p) return Promise.reject(new Error('No page ' + n + ' in that PDF.'));
      if (typeof document === 'undefined') return Promise.reject(new Error('This device cannot draw the page.'));
      var stopped = function () { return ctx.stopped() || isCancelled(opts.signal); };
      var intent = opts.intent === 'print' ? 'print' : 'display';
      return canPaint().then(function (ok) {
        if (!ok && intent !== 'print') {
          if (opts.whenHidden === 'fail') throw namedError('HiddenError', 'The page is hidden, so it can’t be drawn right now.');
          if (opts.whenHidden !== 'wait') intent = 'print';
        }
        return Promise.all([doc.getPage(p), layerConfig(opts.layers)]);
      }).then(function (got) {
        var page = got[0], lc = got[1];
        var mid = ctx.guard(opts.signal);
        if (mid) throw mid;
        var vp1 = page.getViewport({ scale: 1 });
        var r = readRect(rect, vp1.width, vp1.height);
        r = vCut(r, { x0: 0, y0: 0, x1: vp1.width, y1: vp1.height });
        var rw = r.x1 - r.x0, rh = r.y1 - r.y0;
        if (!(rw > 0 && rh > 0)) throw new Error('That rectangle is outside the page.');
        var scale = 1;
        if (opts.scale > 0) scale = opts.scale;
        else if (opts.width > 0) scale = opts.width / rw;      // an exact pixel width (sew-visual)
        else if (opts.height > 0) scale = opts.height / rh;
        else if (opts.dpi > 0) scale = opts.dpi / 72;
        else if (opts.maxSide > 0) scale = opts.maxSide / Math.max(rw, rh);
        else if (opts.maxWidth > 0) scale = opts.maxWidth / rw;
        var clamped = false;
        var cap = Math.min(MAX_RENDER_PIXELS, opts.maxPixels > 0 ? opts.maxPixels : MAX_RENDER_PIXELS);
        if (rw * scale * rh * scale > cap) { scale = Math.sqrt(cap / (rw * rh)); clamped = true; }
        if (Math.max(rw, rh) * scale > MAX_RENDER_SIDE) { scale = MAX_RENDER_SIDE / Math.max(rw, rh); clamped = true; }
        var cw = Math.max(1, Math.round(rw * scale)), ch = Math.max(1, Math.round(rh * scale));
        var vp = page.getViewport({ scale: scale, offsetX: -r.x0 * scale, offsetY: -r.y0 * scale });
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var g = canvas.getContext('2d');
        if (!g) throw new Error('This device cannot draw the page.');
        if (opts.background !== false) { g.fillStyle = opts.background || '#ffffff'; g.fillRect(0, 0, cw, ch); }
        var params = { canvasContext: g, viewport: vp, intent: intent };
        if (lc && lc.cfg) params.optionalContentConfigPromise = Promise.resolve(lc.cfg);
        var task = page.render(params);
        var done = task && task.promise ? task.promise : Promise.resolve();
        var watch = null, timer = null;
        var aborted = new Promise(function (resolve, reject) {
          watch = setInterval(function () {
            if (!stopped()) return;
            if (task && typeof task.cancel === 'function') { try { task.cancel(); } catch (e) { /* done */ } }
            reject(ctx.guard(opts.signal) || abortError());
          }, 40);
          if (opts.budgetMs > 0) {
            timer = setTimeout(function () {
              if (task && typeof task.cancel === 'function') { try { task.cancel(); } catch (e) { /* done */ } }
              reject(namedError('TimeoutError', 'That page took too long to draw.'));
            }, opts.budgetMs);
          }
        });
        var finish = function () {
          if (watch) { clearInterval(watch); watch = null; }
          if (timer) { clearTimeout(timer); timer = null; }
          if (typeof page.cleanup === 'function') { try { page.cleanup(); } catch (e) { /* busy */ } }
        };
        return Promise.race([done, aborted]).then(function () {
          finish();
          var after = ctx.guard(opts.signal);
          if (after) { canvas.width = 0; canvas.height = 0; throw after; }
          var region = { page: p, box: { x0: r2(r.x0), y0: r2(r.y0), x1: r2(r.x1), y1: r2(r.y1) }, scale: scale,
            clamped: clamped, intent: intent, layersUnknown: lc && lc.unknown && lc.unknown.length ? lc.unknown : null };
          if (opts.imageData) {
            var data = g.getImageData(0, 0, cw, ch);
            data.region = region;
            canvas.width = 0; canvas.height = 0;
            return data;
          }
          canvas.region = region;
          if (region.layersUnknown) canvas.layersUnknown = region.layersUnknown;
          return canvas;
        }, function (err) {
          finish();
          canvas.width = 0; canvas.height = 0;
          if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw err;
          if (stopped() || (err && err.name === 'RenderingCancelledException')) throw ctx.guard(opts.signal) || abortError();
          throw err;
        });
      });
    }

    /** rect in tiles no bigger than the pixel cap, one at a time. */
    function renderTiles(n, rect, opts, onTile) {
      opts = opts || {};
      var p = pageNo(n);
      if (!p) return Promise.reject(new Error('No page ' + n + ' in that PDF.'));
      return doc.getPage(p).then(function (page) {
        var vp1 = page.getViewport({ scale: 1 });
        var r = vCut(readRect(rect, vp1.width, vp1.height), { x0: 0, y0: 0, x1: vp1.width, y1: vp1.height });
        var scale = opts.scale > 0 ? opts.scale : opts.dpi > 0 ? opts.dpi / 72 : 2;
        var cap = Math.min(MAX_RENDER_PIXELS, opts.maxPixels > 0 ? opts.maxPixels : MAX_RENDER_PIXELS);
        var side = Math.min(MAX_RENDER_SIDE, Math.floor(Math.sqrt(cap))) / scale;   // a tile's side in page units
        var nx = Math.max(1, Math.ceil((r.x1 - r.x0) / side)), ny = Math.max(1, Math.ceil((r.y1 - r.y0) / side));
        var tiles = [];
        for (var ty = 0; ty < ny; ty++) {
          for (var tx = 0; tx < nx; tx++) {
            tiles.push({ col: tx, row: ty, box: { x0: r.x0 + tx * side, y0: r.y0 + ty * side,
              x1: Math.min(r.x1, r.x0 + (tx + 1) * side), y1: Math.min(r.y1, r.y0 + (ty + 1) * side) } });
          }
        }
        var chain = Promise.resolve();
        tiles.forEach(function (t, i) {
          chain = chain.then(function () {
            var o = {};
            for (var k in opts) o[k] = opts[k];
            o.scale = scale;
            delete o.maxSide; delete o.dpi;
            return renderRegion(p, t.box, o).then(function (cv) {
              t.i = i;
              t.px = { w: cv.width, h: cv.height };
              return Promise.resolve(typeof onTile === 'function' ? onTile(cv, t) : null).then(function () {
                if (!opts.keep) { cv.width = 0; cv.height = 0; }
              });
            });
          });
        });
        return chain.then(function () { return { tiles: tiles, cols: nx, rows: ny, scale: scale }; });
      });
    }

    /** The decoded bitmap of image draw `index` on page n (capped to maxSide). */
    function renderImage(n, index, opts) {
      opts = opts || {};
      var maxSide = opts.maxSide > 0 ? opts.maxSide : 1024;
      return layout(n, { signal: opts.signal }).then(function (lay) {
        var im = lay.images[index];
        if (!im) throw new Error('No picture ' + index + ' on page ' + n + '.');
        var fallback = function () {
          var w = im.box.x1 - im.box.x0, h = im.box.y1 - im.box.y0;
          var want = im.px ? Math.max(im.px.w / Math.max(w, 1), im.px.h / Math.max(h, 1)) : 2;
          var scale = Math.min(Math.max(want, 1), maxSide / Math.max(w, h, 1));
          return renderRegion(n, im.box, { scale: scale, signal: opts.signal, whenHidden: opts.whenHidden }).then(function (cv) {
            // a picture drawn whole and unturned comes back at its own pixel size
            if (!im.px || im.clipped) { cv.image = null; return cv; }
            var k = Math.min(1, maxSide / Math.max(im.px.w, im.px.h));
            var tw = Math.max(1, Math.round(im.px.w * k)), th = Math.max(1, Math.round(im.px.h * k));
            if (tw === cv.width && th === cv.height) { cv.image = { w: im.px.w, h: im.px.h, rendered: true }; return cv; }
            var o = document.createElement('canvas');
            o.width = tw; o.height = th;
            o.getContext('2d').drawImage(cv, 0, 0, tw, th);
            o.region = cv.region;
            o.image = { w: im.px.w, h: im.px.h, rendered: true };
            cv.width = 0; cv.height = 0;
            return o;
          });
        };
        if (im.mask || (!im.id && !im.inline)) return fallback();
        return doc.getPage(lay.page).then(function (page) {
          return page.getOperatorList().then(function (ol) {
            if (!im.id) {
              // a small picture pdf.js inlined: its pixels are in the op's args
              var OPS = window.pdfjsLib.OPS;
              var a = ol.fnArray[im.op] === OPS.paintInlineImageXObject && ol.argsArray[im.op];
              return a && a[0] ? a[0] : null;
            }
            var objs = im.id.indexOf('g_') === 0 ? page.commonObjs : page.objs;
            // pdf.js does not send a page's pictures twice: once the page
            // has been cleaned up the bitmap is gone, and the crop rendered
            // at the picture's own density (fallback) stands in for it
            return new Promise(function (resolve) {
              var t = setTimeout(function () { resolve(null); }, 250);
              try { objs.get(im.id, function (o) { clearTimeout(t); resolve(o); }); } catch (e) { clearTimeout(t); resolve(null); }
            });
          }).then(function (o) {
            if (!o || !(o.width > 0) || !(o.height > 0)) { page.cleanup(); return fallback(); }
            var k = Math.min(1, maxSide / Math.max(o.width, o.height));
            var cw = Math.max(1, Math.round(o.width * k)), ch = Math.max(1, Math.round(o.height * k));
            var full = document.createElement('canvas');
            full.width = o.width; full.height = o.height;
            var g = full.getContext('2d');
            if (o.bitmap) g.drawImage(o.bitmap, 0, 0);
            else if (o.data) {
              var id = g.createImageData(o.width, o.height), src = o.data, dst = id.data, px = o.width * o.height, j;
              if (o.kind === 3) dst.set(src.subarray(0, px * 4));
              else if (o.kind === 2) for (j = 0; j < px; j++) { dst[j * 4] = src[j * 3]; dst[j * 4 + 1] = src[j * 3 + 1]; dst[j * 4 + 2] = src[j * 3 + 2]; dst[j * 4 + 3] = 255; }
              else if (o.kind === 1) {
                var rowBytes = (o.width + 7) >> 3;
                for (j = 0; j < px; j++) {
                  var yy = Math.floor(j / o.width), xx = j % o.width;
                  var bit = (src[yy * rowBytes + (xx >> 3)] >> (7 - (xx & 7))) & 1;
                  dst[j * 4] = dst[j * 4 + 1] = dst[j * 4 + 2] = bit ? 255 : 0; dst[j * 4 + 3] = 255;
                }
              } else { page.cleanup(); full.width = 0; return fallback(); }
              g.putImageData(id, 0, 0);
            } else { page.cleanup(); full.width = 0; return fallback(); }
            page.cleanup();
            if (k === 1) { full.image = { w: o.width, h: o.height }; return full; }
            var out = document.createElement('canvas');
            out.width = cw; out.height = ch;
            out.getContext('2d').drawImage(full, 0, 0, cw, ch);
            full.width = 0; full.height = 0;
            out.image = { w: o.width, h: o.height };
            return out;
          });
        });
      });
    }

    /** A guess per page, one page at a time, yielding between pages. */
    function pageKinds(opts) {
      opts = opts || {};
      var total = doc.numPages || 0;
      if (opts.maxPages > 0) total = Math.min(total, Math.floor(opts.maxPages));
      var out = [];
      var chain = Promise.resolve();
      var mem = function () {
        try { return performance && performance.memory ? performance.memory.usedJSHeapSize : null; } catch (e) { return null; }
      };
      for (var q = 1; q <= total; q++) {
        (function (pn) {
          chain = chain.then(function () {
            var stop = ctx.guard(opts.signal);
            if (stop) throw stop;
            if (typeof opts.onProgress === 'function') { try { opts.onProgress(pn, total); } catch (e) { /* UI */ } }
            var m0 = mem();
            return layout(pn, { signal: opts.signal }).then(function (lay) {
              var k = lay.kind, m1 = mem();
              out.push({ page: pn, guess: k.guess, confidence: k.confidence, reasons: k.reasons, scores: k.scores,
                ms: lay.stats.ms, mainMs: lay.stats.mainMs, ops: lay.stats.ops, heap: m0 != null && m1 != null ? m1 - m0 : null });
              return pause();     // let the page breathe
            });
          });
        })(q);
      }
      return chain.then(function () { return out; });
    }

    // renderPage(n, {layers | whenHidden}) goes through renderRegion (the
    // whole page); without those options it is exactly the old call.
    var plainRender = handle.renderPage;
    handle.renderPage = function (n, ropts) {
      if (!ropts || (!ropts.layers && !ropts.whenHidden)) return plainRender(n, ropts);
      var o = {};
      for (var k in ropts) o[k] = ropts[k];
      return renderRegion(n, null, o);
    };
    // textOf(n) of a page given OCR lines is those lines; any other page is
    // exactly the old call
    var plainTextOf = handle.textOf;
    handle.textOf = function (n) {
      var p = pageNo(n);
      if (p && attached[p] && !ctx.guard()) {
        return Promise.resolve(attached[p].map(function (l) { return l.text; }).join('\n'));
      }
      return plainTextOf(n);
    };
    handle.setPageText = setPageText;
    handle.ocrPages = ocrPagesNow;
    handle.layout = layout;
    handle.textIn = textIn;
    handle.find = find;
    handle.glyphs = glyphsOf;
    handle.chart = chartOf;
    handle.renderGlyph = renderGlyph;
    handle.layers = layersOf;
    handle.layerConfig = layerConfig;
    handle.renderRegion = renderRegion;
    handle.renderTiles = renderTiles;
    handle.renderImage = renderImage;
    handle.pageKinds = pageKinds;
    return handle;
  }

  window.PdfText = {
    extract: extract,
    open: open,
    isAvailable: isAvailable,
    SIZE_WARN_BYTES: SIZE_WARN_BYTES,
    MIN_PAGE_CHARS: MIN_PAGE_CHARS,
    /* wave K: page structure (docs/wave-k/api/pdftext.md) */
    LAYOUT_VERSION: LAYOUT_VERSION,
    MAX_RENDER_PIXELS: MAX_RENDER_PIXELS,
    MAX_RENDER_SIDE: MAX_RENDER_SIDE,
    canPaint: canPaint,
    glyphGrid: function (glyphs, opts) {
      return glyphGrid((glyphs || []).map(function (g) {
        if (g.vbox || !g.box) return g;
        var o = {};
        for (var k in g) o[k] = g[k];
        o.vbox = g.box;
        return o;
      }), opts);
    },
    chartFonts: chartFonts,
    _pageGraphics: pageGraphics,
    _drawingRegions: drawingRegions,
    _captions: captions,
    _pageKind: pageKind,
    _periodOf: periodOf,
    _latticeOf: latticeOf,
    _itemBox: itemBox,
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
    _rowIsTracked: rowIsTracked,
    _textVisibility: textVisibility,
    _imageAlphaOf: imageAlphaOf,
    _horizontalBands: horizontalBands,
    _columnizeAt: function (rows, x0, x1, minLines) { return columnizeAt(rows, x0, x1, { left: MAX_COLUMNS - 1 }, minLines || MIN_LINES_FOR_COLUMNS); },
    _bridgesGutter: bridgesGutter,
    _cellCount: cellCount,
    _isTableBand: isTableBand,
    _dropHiddenItems: dropHiddenItems,
    _overlaySuspect: overlaySuspect,
    _crossPageSuspects: crossPageSuspects,
    _dropRunningFurniture: dropRunningFurniture,
    _anywhereKeys: anywhereKeys,
    _caseSuspect: caseSuspect,
    _restoreCase: restoreCase,
    _drawnAsNamed: drawnAsNamed,
    _caseByWidth: caseByWidth,
    _widthInfo: widthInfo
  };
})();
