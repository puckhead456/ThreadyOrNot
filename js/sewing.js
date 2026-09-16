// js/sewing.js
// window.Sewing - sewing / quilting / bag-making instruction-booklet parser + data model.
// Pure functions: no DOM, no storage, no network. Unit-tested by test/sewing.test.html.
//
// Sections of this file:
//   1. helpers
//   2. normalizeText
//   3. lines, pages, headings, blocks
//   4. steps
//   5. cutting list
//   6. notions
//   7. seam allowance
//   8. sizes + fabric requirements
//   9. meta, kind detection, quilt unit counters
//  10. parse()
//  11. craftData: normalize / toCraftData / summary / templates
//
// Techniques (line-marker regex families, section-restart-on-decrease, wrapped-line
// continuation, heading heuristics) are copied as *design* from js/patterns.js and
// reimplemented here; nothing is imported, so the two parsers can diverge freely.
'use strict';

(function () {

  // =====================================================================
  // 1. Helpers
  // =====================================================================

  function str(v, d) { return typeof v === 'string' ? v : (d === undefined ? '' : d); }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArr(v); }

  function clampInt(v, lo, hi, d) {
    var n = typeof v === 'number' ? Math.round(v) : parseInt(v, 10);
    if (isNaN(n)) return d;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function deepCopy(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
  }

  var seq = 0;
  function uid(prefix) {
    seq++;
    return (prefix || 'sw') + seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /** Comparison key: lowercase, letters+digits only. Used for merge matching. */
  function key(s) {
    return str(s, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
  }

  function pushUnique(list, s) {
    s = str(s, '').trim();
    if (!s) return;
    for (var i = 0; i < list.length; i++) if (list[i] === s) return;
    list.push(s);
  }

  function titleCase(s) {
    return str(s, '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  /** 'CONSTRUCTION' -> 'Construction', 'VIEW A' -> 'View A'. Mixed case is left alone. */
  function prettyHeading(s) {
    s = str(s, '').trim();
    if (!s) return '';
    if (!/[a-z]/.test(s) && s.length > 3) {
      return s.split(/\s+/).map(function (w) {
        if (w.length === 1) return w.toUpperCase();
        if (/^[A-Z]&[A-Z]$/.test(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }).join(' ');
    }
    return s;
  }

  /** '1 1/2' | '1/2' | '1.5' | '2' -> Number, or null. */
  function numValue(s) {
    s = str(s, '').trim().replace(/\s+/g, ' ');
    if (!s) return null;
    var m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s);
    if (m) { var d = parseInt(m[3], 10); return d ? parseInt(m[1], 10) + parseInt(m[2], 10) / d : null; }
    m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
    if (m) { var d2 = parseInt(m[2], 10); return d2 ? parseInt(m[1], 10) / d2 : null; }
    m = /^(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return parseFloat(m[1]);
    return null;
  }

  var MM_PER = { cm: 10, mm: 1, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4 };

  function toMm(valueStr, unit) {
    var v = numValue(valueStr);
    if (v === null) return null;
    var f = MM_PER[str(unit, '').toLowerCase()];
    if (!f) return null;
    return Math.round(v * f);
  }

  function isImperial(unit) {
    var u = str(unit, '').toLowerCase();
    return u === '"' || u === 'in' || u === 'inch' || u === 'inches';
  }

  var WORD_NUM = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
  };

  // =====================================================================
  // 2. normalizeText
  // =====================================================================

  var FRACTIONS = {
    '¼': '1/4', '½': '1/2', '¾': '3/4',
    '⅐': '1/7', '⅑': '1/9', '⅒': '1/10',
    '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5',
    '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6',
    '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
  };
  var FRAC_CLASS = /[¼¾½⅐-⅞]/g;
  var FRAC_AFTER_DIGIT = /(\d)[ \t]*([¼¾½⅐-⅞])/g;
  // Dot leaders, spaced or solid: 'Front . . . . Cut 2' and 'Front........Cut 2'.
  var LEADER_RE = /(?:[.·…–—_\-][ \t]*){3,}/g;
  var UNI_DASH = /[‐-―−]/g;
  var LEADER_MARK = '';

  /**
   * Glyph / fraction / dot-leader normalisation. Idempotent.
   * `=== PAGE n ===` markers survive untouched.
   */
  function normalizeText(text) {
    if (typeof text !== 'string' || !text) return '';
    var s = text;
    s = s.replace(/\r\n?/g, '\n');
    s = s.replace(/[     ]/g, ' ');
    s = s.replace(/[​‌‍﻿]/g, '');
    // quotes and prime marks
    s = s.replace(/[“”„‟″]/g, '"');
    s = s.replace(/[‘’‚‛′]/g, "'");
    s = s.replace(/''/g, '"');
    s = s.replace(/``/g, '"');
    // fractions: glued to a digit gains a space (4 1/2), standalone expands in place
    s = s.replace(FRAC_AFTER_DIGIT, function (m, d, f) { return d + ' ' + FRACTIONS[f]; });
    s = s.replace(FRAC_CLASS, function (f) { return FRACTIONS[f] || f; });
    // dot leaders / long dash runs -> a protected separator
    s = s.replace(LEADER_RE, LEADER_MARK);
    s = s.replace(/…+/g, LEADER_MARK);
    // remaining typographic dashes -> ascii hyphen
    s = s.replace(UNI_DASH, '-');
    // hyphenated mixed numbers: 2-1/2 -> 2 1/2
    s = s.replace(/(\d)\s*-\s*(\d+\s*\/\s*\d+)/g, '$1 $2');
    // a fraction split by a stray space: '5 /8 "' -> '5/8 "' (Pattern Runway booklets)
    s = s.replace(/(\b\d)[ \t]+\/[ \t]*(\d{1,2})(?!\d)/g, '$1/$2');
    s = s.replace(new RegExp(LEADER_MARK, 'g'), ' — ');
    // whitespace (newlines preserved)
    s = s.replace(/[ \t\f\v]+/g, ' ');
    s = s.split('\n').map(function (l) { return l.replace(/^\s+|\s+$/g, ''); }).join('\n');
    return s;
  }

  // =====================================================================
  // 3. Lines, pages, headings, blocks
  // =====================================================================

  var PAGE_RE = /^===\s*PAGE\s+(\d+)\s*===$/i;

  /**
   * Accepts a raw string, an array of strings, or an array of {text,page} rows.
   * Returns [{ text, page, pageMark }]. Strings are normalised on the way in.
   */
  function toLines(input) {
    var out = [];
    var raw;
    if (typeof input === 'string') {
      raw = normalizeText(input).split('\n');
    } else if (isArr(input)) {
      var allStrings = true;
      for (var a = 0; a < input.length; a++) {
        if (input[a] && typeof input[a] === 'object') { allStrings = false; break; }
      }
      raw = allStrings ? normalizeText(input.join('\n')).split('\n') : input;
    } else {
      return out;
    }
    var page = null;
    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      if (item && typeof item === 'object') {
        out.push({
          text: str(item.text, ''),
          page: typeof item.page === 'number' ? item.page : page,
          pageMark: !!item.pageMark
        });
        continue;
      }
      var t = str(item, '').replace(/^\s+|\s+$/g, '');
      var m = PAGE_RE.exec(t);
      if (m) {
        page = parseInt(m[1], 10);
        out.push({ text: '', page: page, pageMark: true });
        continue;
      }
      out.push({ text: t, page: page, pageMark: false });
    }
    return out;
  }

  var HEAD_MAX = 48;
  var ALLCAPS_RE = /^[A-Z0-9][A-Z0-9 '&\/()."%-]*$/;
  var TITLE_RE = /^([A-Z][A-Za-z'-]*)(\s+([A-Z][A-Za-z0-9'-]*|&|of|the|and|in|a|an|for|to|with|your|my|on|at))*$/;

  /** Strip a leading '3. ' style number and a trailing colon from a heading. */
  function headingText(t) {
    return str(t, '').replace(/^\s+|\s+$/g, '')
      .replace(/^\d{1,2}\s*[.):]\s*/, '')
      .replace(/\s*:\s*$/, '')
      .replace(/^\s+|\s+$/g, '');
  }

  function isHeading(t) {
    var s = str(t, '').replace(/^\s+|\s+$/g, '');
    if (!s || s.length > HEAD_MAX) return false;
    if (/[.!?,;]$/.test(s)) return false;
    var core = headingText(s);
    if (!core || !/[A-Za-z]/.test(core)) return false;
    if (core.split(/\s+/).length > 7) return false;
    if (!/[a-z]/.test(core) && ALLCAPS_RE.test(core) && /[A-Z]{2}/.test(core)) return true;
    return TITLE_RE.test(core);
  }

  var HEAD_PATTERNS = [
    ['cut', /^(?:cutting(?:\s+(?:instructions?|list|guide|directions?|out))?|cut(?:ting)?\s+your\s+fabric|cut\s+list|cutting\s+and\s+marking|pattern\s+pieces|pieces\s+to\s+cut|from\s+(?:fabric\s+)?[a-z0-9][a-z0-9 ]{0,24})$/i],
    ['notions', /^(?:notions?(?:\s+(?:list|needed|and\s+supplies))?|supplies|you\s*'?\s*(?:ll|will)\s+need|what\s+you\s*'?\s*(?:ll|will)\s+need|haberdashery|hardware(?:\s+list)?|materials?(?:\s+(?:list|needed|and\s+notions))?|tools?(?:\s+and\s+supplies)?|interfacing(?:\s+list)?)$/i],
    ['fabric', /^(?:fabrics?(?:\s+(?:requirements?|suggestions?|recommendations?|needed|and\s+notions))?|yardage(?:\s+requirements?)?|requirements?|fabric\s+quantities)$/i],
    ['size', /^(?:size\s+chart|sizing|sizes?|body\s+measurements?|finished\s+(?:garment\s+)?measurements?|measurements?|finished\s+sizes?|size\s+guide)$/i],
    ['steps', /^(?:construction(?:\s+.*)?|instructions?|sewing\s+instructions?|let\s*'?s\s+sew|assembly|block\s+assembly|quilt\s+top\s+assembly|piecing|finishing(?:\s+.*)?|hem(?:ming)?|view\s+[a-z](?:\b.*)?|making\s+up|method|steps?|sew(?:ing)?\s+the\s+.*|attaching\s+the\s+.*|the\s+[a-z]+)$/i],
    // Reference matter. It reads like instructions (numbered lists, titled
    // paragraphs) but is never a construction step, a notion or a cut piece.
    // NB: 'Key' and 'Legend' are deliberately NOT here — they are printed
    // *inside* the sewing instructions and would cut the steps block in half.
    ['skip', /^(?:glossary|terms|pattern\s+symbols?|pattern\s+markings?|before\s+(?:you\s+)?start(?:ing)?(?:\s+.*)?|getting\s+started|creating\s+a\s+perfect\s+fit|how\s+to\s+(?:measure|choose|use|read|print)(?:\s+.*)?|my\s+measurements|lengthen(?:ing)?\s*\/?\s*shorten(?:ing)?|choosing\s+your\s+size|about\s+(?:this\s+)?pattern|sewing\s+level|suggested\s+fabrics?|printing(?:\s+.*)?|copyright(?:\s+.*)?|abbreviations?|difficulty)$/i]
  ];

  function headingKind(core) {
    var s = str(core, '').replace(/^\s+|\s+$/g, '');
    if (!s) return null;
    for (var i = 0; i < HEAD_PATTERNS.length; i++) {
      if (HEAD_PATTERNS[i][1].test(s)) return HEAD_PATTERNS[i][0];
    }
    return null;
  }

  /**
   * Walk the lines and tag each with the block it sits in.
   * kinds[i] is 'head' | 'cut' | 'notions' | 'fabric' | 'size' | 'steps' | 'none'.
   * A block ends at the next recognised heading, after 60 non-blank lines, or at a
   * step marker its own parser cannot consume (so a numbered cutting list stays
   * a cutting list, but real construction steps resume).
   */
  function classify(lines) {
    var kinds = new Array(lines.length);
    var heads = new Array(lines.length);
    var owners = new Array(lines.length);   // the block a heading line sits in
    var cur = 'none', head = '', count = 0, sawSteps = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.text;
      if (ln.pageMark || !t) { kinds[i] = ln.pageMark ? 'page' : cur; heads[i] = head; continue; }
      if (isHeading(t) && !sizeHeader(t)) {
        var core = headingText(t);
        var k = headingKind(core);
        if (k) { cur = k; count = 0; if (k === 'steps') sawSteps = true; }
        // An unrecognised heading ('Sleeve Length:', 'To Lengthen a Bodice:')
        // does not break out of a steps or skip block — it just names a section.
        else if (cur !== 'none' && cur !== 'steps' && cur !== 'skip') { cur = 'none'; }
        head = core;
        kinds[i] = 'head';
        heads[i] = core;
        owners[i] = cur;
        continue;
      }
      // A 'skip' block (glossary, pattern symbols, how-to-measure) ends only at
      // the next recognised heading: its numbered lists must never leak out.
      if (cur !== 'none' && cur !== 'steps' && cur !== 'skip') {
        count++;
        if (count > 60) cur = 'none';
        else if (endsBlock(t, cur)) cur = 'none';
      }
      kinds[i] = cur;
      heads[i] = head;
    }
    return { kinds: kinds, heads: heads, owners: owners, hasSteps: sawSteps };
  }

  /** True when at least one line sits inside a recognised steps block. */
  function hasStepsBlock(kinds) {
    for (var i = 0; i < kinds.length; i++) if (kinds[i] === 'steps') return true;
    return false;
  }

  function endsBlock(text, kind) {
    var mk = stepMarker(text);
    if (!mk) return false;
    if (kind === 'cut') return !cutRow(text, null);
    return true;
  }

  // =====================================================================
  // 4. Steps
  // =====================================================================

  var BULLET_RE = /^[\-*•●▪·]\s+/;
  // `\s*` after the separator, not `\s+`: Pattern Runway prints '1.Stabilise the
  // waist:' with no space. REST_OK_RE still throws out '1.5 cm' and '2. 5 mm'.
  var MARK_NUM_RE = /^(step\s*)?(\d{1,3})\s*([.)\]:\-])\s*(\S.*)$/i;
  var MARK_STEP_RE = /^step\s*[#]?\s*(\d{1,3})\b[.:)\-]?\s*(.*)$/i;
  var UNIT_START_RE = /^(?:cm|mm|m|in|inch(?:es)?|"|yd|yards?|yds)\b/i;
  var REST_OK_RE = /^[A-Za-z("']/;

  /** { n, rest, marker } for a step-marker line, else null. */
  function stepMarker(text) {
    var s = str(text, '').replace(/^\s+|\s+$/g, '').replace(BULLET_RE, '');
    if (!s || s.length > 900) return null;
    var m = MARK_NUM_RE.exec(s);
    if (m) {
      var rest = m[4].replace(/^\s+/, '');
      if (UNIT_START_RE.test(rest)) return null;   // '1. cm ...'
      if (!REST_OK_RE.test(rest)) return null;     // '2. 5 mm', '1. 1/2"'
      return {
        n: parseInt(m[2], 10),
        rest: rest,
        marker: m[1] ? 'Step' : (m[3] === ')' ? '1)' : '1.')
      };
    }
    m = MARK_STEP_RE.exec(s);
    if (m) {
      var rest2 = m[2].replace(/^\s+/, '');
      if (rest2 && !REST_OK_RE.test(rest2)) return null;
      if (UNIT_START_RE.test(rest2)) return null;
      return { n: parseInt(m[1], 10), rest: rest2, marker: 'Step' };
    }
    return null;
  }

  /**
   * A titled paragraph inside the steps block: 'Centre Back Seam: Align right
   * sides together…'. Plenty of respected publishers number nothing and simply
   * bold the title of each operation. Only ever applied inside a steps block.
   */
  var TITLE_STEP_RE = /^([A-Z][A-Za-z'\/&\- ]{2,48}):\s+(\S.*)$/;
  var TITLE_STEP_BAD = /^(?:note|please note|tip|hint|warning|key|legend|fig|figure|size|sizes|size chart|fabric|fabrics|notions|trims|supplies|materials|hardware|tools|seam allowances?(?: & hems)?|my measurements|copyright(?: info)?|sewing level|suggested fabrics|glossary|e|w|t|www|email|contact|disclaimer|terms)$/i;

  /** { title, rest } for a titled-paragraph step, else null. */
  function titleStep(text) {
    var s = str(text, '').replace(/^\s+|\s+$/g, '').replace(BULLET_RE, '');
    if (!s || s.length > 900) return null;
    var m = TITLE_STEP_RE.exec(s);
    if (!m) return null;
    var title = m[1].replace(/\s+$/, '');
    if (TITLE_STEP_BAD.test(title)) return null;
    if (title.split(/\s+/).length > 7) return null;
    // The body has to be a real sentence, not another label on the same line.
    if (!/[a-z]/.test(m[2])) return null;
    return { title: title, rest: m[2].replace(/^\s+/, '') };
  }

  var STEP_TEXT_CAP = 800;

  /**
   * parseSteps(lines, opts) -> StepRow[]  (with a non-enumerable `.warnings`)
   * opts: { blocks, columns, fallback:true|false }
   */
  function parseSteps(input, opts) {
    opts = opts || {};
    var lines = toLines(input);
    var info = opts.blocks || classify(lines);
    var kinds = info.kinds, heads = info.heads, owners = info.owners;
    var steps = [];
    var warns = [];
    var lastN = 0, section = '', cur = null;
    var candidates = 0, jumped = 0, sectionSeq = 1, capped = false, truncated = 0;
    var firstIndex = -1;
    var justCrossedPage = false, lastStep = null, pending = null;

    // When the booklet has a real steps block, nothing outside it is a step:
    // the numbered list under "How to Measure the Body" is not construction.
    var stepsOnly = opts.stepsOnly === undefined
      ? (info.hasSteps || hasStepsBlock(kinds))
      : !!opts.stepsOnly;

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.text;
      // PdfText prints a blank line before each '=== PAGE n ===', so the step
      // that was running has already been closed by the time the marker
      // arrives. Hold on to it so the rest of the paragraph can rejoin it.
      if (ln.pageMark) {
        var carry = cur || pending;
        if (carry) { lastStep = carry; justCrossedPage = true; }
        cur = null; pending = null;
        continue;
      }
      if (!t) { if (cur) pending = cur; cur = null; continue; }
      var k = kinds[i];
      if (k === 'head') {
        // '3.Side Seams' and '5.Waistband:' read as Title Case headings, but
        // inside the sewing instructions they are numbered steps.
        if (owners && owners[i] === 'steps') {
          var hm = stepMarker(t);
          if (hm && hm.n <= lastN + 12) {
            cur = {
              n: hm.n, section: section, text: hm.rest,
              page: typeof ln.page === 'number' ? ln.page : null, marker: hm.marker
            };
            if (steps.length < 200) {
              steps.push(cur);
              if (firstIndex < 0) firstIndex = i;
              lastN = hm.n;
            } else { capped = true; cur = null; }
            justCrossedPage = false; lastStep = null; pending = null;
            continue;
          }
        }
        // 'Key:' / 'Note:' name a legend, not a section of the garment.
        if (!TITLE_STEP_BAD.test(headingText(heads[i] || ''))) section = prettyHeading(heads[i]);
        cur = null; lastStep = null; justCrossedPage = false; pending = null;
        continue;
      }
      var inStepsBlock = (k === 'steps');
      var inOtherBlock = (k === 'cut' || k === 'notions' || k === 'fabric' || k === 'size' || k === 'skip');
      if (stepsOnly && !inStepsBlock) { cur = null; lastStep = null; justCrossedPage = false; pending = null; continue; }
      var mk = inOtherBlock ? null : stepMarker(t);
      if (!mk && inStepsBlock) {
        var ts = titleStep(t);
        if (ts) {
          if (steps.length < 200) {
            cur = {
              n: lastN || (steps.length + 1),
              section: section,
              text: ts.title + ': ' + ts.rest,
              page: typeof ln.page === 'number' ? ln.page : null,
              marker: 'title'
            };
            steps.push(cur);
            if (firstIndex < 0) firstIndex = i;
          } else {
            capped = true;
            cur = null;
          }
          justCrossedPage = false; lastStep = null; pending = null;
          continue;
        }
      }
      if (mk) {
        candidates++;
        if (mk.n > lastN + 12) { jumped++; cur = null; continue; }
        if (steps.length >= 200) { capped = true; cur = null; continue; }
        if (mk.n <= lastN && steps.length) {
          var prevSection = steps[steps.length - 1].section;
          if (section === prevSection) { sectionSeq++; section = 'Section ' + sectionSeq; }
        }
        cur = {
          n: mk.n,
          section: section,
          text: mk.rest,
          page: typeof ln.page === 'number' ? ln.page : null,
          marker: mk.marker
        };
        steps.push(cur);
        if (firstIndex < 0) firstIndex = i;
        lastN = mk.n;
        justCrossedPage = false; lastStep = null; pending = null;
        continue;
      }
      // A step that ran over a page break carries on: the PDF put a page marker
      // in the middle of the paragraph, not a new instruction.
      if (!cur && justCrossedPage && lastStep && !inOtherBlock) {
        cur = lastStep;
        lastStep = null;
      }
      justCrossedPage = false;
      pending = null;
      if (cur && !inOtherBlock) {
        // Trimming the part-word off the end can drop the text back under the
        // cap, so the ellipsis is what marks a step as full — not its length.
        var full = cur.text.charAt(cur.text.length - 1) === '…';
        if (!full && cur.text.length < STEP_TEXT_CAP) {
          cur.text = cur.text ? (cur.text + ' ' + t) : t;
          if (cur.text.length > STEP_TEXT_CAP) {
            cur.text = cur.text.slice(0, STEP_TEXT_CAP).replace(/\s+\S*$/, '') + '…';
            truncated++;
          }
        }
      }
    }

    if (capped) warns.push('More than 200 steps were found — only the first 200 were kept.');
    if (truncated) warns.push(truncated + (truncated === 1 ? ' step was' : ' steps were') + ' very long and got shortened.');
    if (candidates > 0 && jumped / candidates > 0.4) {
      warns.push('This PDF\'s columns may be interleaved' +
        (opts.columns ? ' (' + opts.columns + ' columns detected)' : '') +
        ' — check the steps.');
    }
    if (!steps.length) {
      if (opts.fallback) {
        steps = paragraphSteps(lines, kinds, heads);
        if (steps.length) warns.push('No numbered steps found — each paragraph was made into a step.');
      }
      if (!steps.length) {
        warns.push('No numbered steps found — the text was kept so you can add steps yourself.');
      }
    }

    Object.defineProperty(steps, 'warnings', { value: warns, enumerable: false, configurable: true });
    Object.defineProperty(steps, 'firstIndex', { value: firstIndex, enumerable: false, configurable: true });
    return steps;
  }

  /** Opt-in fallback for booklets with no numbered steps: one step per paragraph run. */
  function paragraphSteps(lines, kinds, heads) {
    var out = [];
    var buf = '', section = '', page = null;
    function flush() {
      var t = buf.replace(/^\s+|\s+$/g, '');
      buf = '';
      if (t.length < 40) return;
      if (out.length >= 200) return;
      out.push({ n: out.length + 1, section: section, text: t.slice(0, STEP_TEXT_CAP), page: page, marker: 'none' });
    }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], t = ln.text, k = kinds[i];
      if (ln.pageMark || !t) { flush(); continue; }
      if (k === 'head') { flush(); section = prettyHeading(heads[i]); continue; }
      if (k === 'cut' || k === 'notions' || k === 'fabric' || k === 'size' || k === 'skip') { flush(); continue; }
      if (!buf) page = typeof ln.page === 'number' ? ln.page : null;
      buf = buf ? (buf + ' ' + t) : t;
    }
    flush();
    return out;
  }

  // =====================================================================
  // 5. Cutting list
  // =====================================================================

  var C_SUBCUT = /^sub-?\s?cut\s+(?:into\s+)?\(?\s*(\d{1,4})\s*\)?\s*(.*)$/i;
  var C_STRIPS = /^\(?\s*(\d{1,3})\s*\)?\s+strips?\s+(.+?)\s*[x×]\s*(?:WOF|width of fabric)\b(.*)$/i;
  var C_FROM_CUT = /^(?:from\s+(.{2,40}?)\s*[,:]\s*)?cut\s*\(?\s*(\d{1,4})\s*\)?\s*(?:[-—:]\s*)?(.*)$/i;
  var C_PIECE_CUT = /^(.{2,48}?)\s*(?:—|-|:)?\s*\bcut\s*\(?\s*(\d{1,3})\s*\)?(?![\d\/])(.*)$/i;
  var C_N_X_PIECE = /^\(?\s*(\d{1,3})\s*\)?\s*[x×]\s*(.{2,48}?)(?:\s*[-—(](.*))?$/i;
  var C_PIECE_X_N = /^(.{2,48}?)\s*[x×]\s*\(?\s*(\d{1,3})\s*\)?\b(.*)$/i;
  var C_FROM_LINE = /^from\s+(?:the\s+)?(.{2,40}?)\s*[,:.]?\s*$/i;
  // What follows the count when the line is prose rather than a cutting row.
  var CUT_REST_BAD = /^\s*(?:x\b|only\b|of\b|each\b|more\b|time|times\b)/i;
  // A "piece name" that is really the tail of a sentence.
  var CUT_PIECE_BAD = /^(?:layout|fold|unfold|re\s*fold|then|and|or|to|please|note|you|we|this|these|those|first|next|now|after|before|position|place|turn|use|using|make|do|see|when|if|with|for|from|it|is|are|be|the|a|an)\b/i;

  var MATERIALS = [
    ['main', /\b(?:main|self|shell|outer|exterior|fashion fabric)\b/i],
    ['lining', /\blinings?\b/i],
    ['interfacing', /\b(?:interfacing|interlining|fusible|sf-?101|shape ?flex|soft and stable|fusible fleece|foam|stabili[sz]er)\b/i],
    ['contrast', /\b(?:contrast(?:ing)?|accent|binding)\b/i],
    ['batting', /\b(?:batting|wadding)\b/i],
    ['other', /\b(?:background|backing|fabric\s+[a-h])\b/i]
  ];
  var MATERIAL_SET = { main: 1, lining: 1, interfacing: 1, contrast: 1, batting: 1, other: 1 };

  function materialOf(s) {
    s = str(s, '');
    if (!s) return null;
    for (var i = 0; i < MATERIALS.length; i++) {
      if (MATERIALS[i][1].test(s)) return MATERIALS[i][0];
    }
    return null;
  }

  var GRAIN_RE = /\b(on the bias|bias|crosswise|lengthwise|grainline|mirrored|mirror|reversed|reverse)\b/i;
  var FOLD_RE = /\bon\s+(?:the\s+)?fold\b/i;
  var DIMS_RE = /(\d[\d ]*(?:\/\d+)?(?:\.\d+)?)\s*(?:"|in\b|inch(?:es)?|cm|mm)?\s*[x×]\s*(\d[\d ]*(?:\/\d+)?(?:\.\d+)?)\s*(?:"|in\b|inch(?:es)?|cm|mm)?/i;
  var PARENS_RE = /\(([^()]{1,40})\)/g;
  var MARKER_STRIP_RE = /^(?:\d{1,3}\s*[.)]\s+)/;

  function parensNote(s) {
    var out = [];
    var m;
    PARENS_RE.lastIndex = 0;
    while ((m = PARENS_RE.exec(s))) {
      var v = m[1].replace(/^\s+|\s+$/g, '');
      if (!v || /^\d+$/.test(v)) continue;
      pushUnique(out, v);
    }
    return out.join(', ');
  }

  function cleanPiece(s) {
    s = str(s, '').replace(/\([^()]{0,40}\)/g, ' ');
    s = s.replace(/^[\s\-—:;,*•]+/, '').replace(/[\s.,;:—-]+$/, '');
    s = s.replace(/\s{2,}/g, ' ');
    return s.replace(/^\s+|\s+$/g, '');
  }

  function singular(s) {
    return str(s, '').replace(/\b(strips|squares|rectangles|pieces|triangles|blocks|units)\b\s*$/i, function (w) {
      return w.slice(0, -1);
    });
  }

  /** A single cutting-list line -> CutRow, or null. `from` is the nearest 'From Fabric A,' context. */
  function cutRow(rawLine, from) {
    var line = str(rawLine, '').replace(/^\s+|\s+$/g, '');
    if (!line || line.length > 120) return null;
    var s = line.replace(BULLET_RE, '').replace(MARKER_STRIP_RE, '').replace(/\s*[.;]\s*$/, '');
    if (!s) return null;

    var qty = null, piece = '', rest = '', fromHere = null, quilty = false;
    var m;

    if ((m = C_SUBCUT.exec(s))) {
      qty = parseInt(m[1], 10);
      piece = singular(cleanPiece(m[2]));
      rest = m[2];
      quilty = true;
    } else if ((m = C_STRIPS.exec(s))) {
      qty = parseInt(m[1], 10);
      piece = cleanPiece(m[2]) + ' x WOF strip';
      rest = m[2] + ' ' + m[3];
      quilty = true;
    } else if ((m = C_FROM_CUT.exec(s))) {
      fromHere = m[1] ? m[1].replace(/^\s+|\s+$/g, '') : null;
      qty = parseInt(m[2], 10);
      rest = m[3] || '';
      // 'cut 1x only', 'cut 1 x each waistband': the number is a multiplier in
      // running prose, not a piece count.
      if (CUT_REST_BAD.test(rest)) return null;
      piece = singular(cleanPiece(rest.replace(/\bfrom\s+(?:the\s+)?[a-z0-9 ]{2,24}$/i, '')));
    } else if ((m = C_PIECE_CUT.exec(s))) {
      piece = cleanPiece(m[1]);
      qty = parseInt(m[2], 10);
      rest = m[3] || '';
      if (CUT_REST_BAD.test(rest)) return null;
      if (CUT_PIECE_BAD.test(piece)) return null;
    } else if ((m = C_N_X_PIECE.exec(s))) {
      qty = parseInt(m[1], 10);
      piece = cleanPiece(m[2]);
      rest = (m[2] || '') + ' ' + (m[3] || '');
    } else if ((m = C_PIECE_X_N.exec(s))) {
      piece = cleanPiece(m[1]);
      qty = parseInt(m[2], 10);
      rest = m[3] || '';
    } else {
      return null;
    }

    if (qty === null || isNaN(qty) || qty < 1 || qty > 9999) return null;

    var scan = s + ' ' + (from || '');
    var note = parensNote(s);
    var material = materialOf(rest) || materialOf(s) || materialOf(from) || 'main';
    if (material === 'other') {
      var lab = /\bfabric\s+[a-h]\b/i.exec(rest) || /\bfabric\s+[a-h]\b/i.exec(s) || /\bfabric\s+[a-h]\b/i.exec(str(from, '')) ||
        /\b(?:background|backing)\b/i.exec(rest) || /\b(?:background|backing)\b/i.exec(s) || /\b(?:background|backing)\b/i.exec(str(from, ''));
      if (lab) note = note ? (note + ', ' + titleCase(lab[0])) : titleCase(lab[0]);
    } else if (quilty && from && !materialOf(rest) && !materialOf(s)) {
      note = note ? (note + ', ' + from) : from;
    }

    var grainM = GRAIN_RE.exec(scan);
    var dimsM = DIMS_RE.exec(s);

    if (!piece) piece = dimsM ? dimsM[0].replace(/^\s+|\s+$/g, '') : 'Piece';
    if (piece.length > 60) piece = piece.slice(0, 60).replace(/\s+\S*$/, '');
    if (piece.length < 2) return null;
    if (/^\d+$/.test(piece)) return null;

    return {
      piece: piece,
      qty: qty,
      material: material,
      onFold: FOLD_RE.test(s),
      grain: grainM ? grainM[0].toLowerCase() : '',
      dims: dimsM ? dimsM[0].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') : '',
      note: note,
      line: line
    };
  }

  /** parseCutting(lines) -> CutRow[] (de-duplicated), with a non-enumerable `.warnings`. */
  function parseCutting(input) {
    var lines = toLines(input);
    var out = [];
    var warns = [];
    var seen = {};
    var from = null;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].text;
      if (!t) continue;
      var fm = C_FROM_LINE.exec(t);
      if (fm && !/\bcut\b/i.test(t)) { from = fm[1]; continue; }
      var row = cutRow(t, from);
      if (!row) continue;
      if (/^from\s+/i.test(t)) {
        var inline = /^from\s+(.{2,40}?)\s*[,:]\s*cut\b/i.exec(t);
        if (inline) from = inline[1];
      }
      var k = key(row.piece) + '|' + row.qty + '|' + row.material;
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(row);
    }
    Object.defineProperty(out, 'warnings', { value: warns, enumerable: false, configurable: true });
    return out;
  }

  // =====================================================================
  // 6. Notions
  // =====================================================================

  var NOTION_VOCAB = new RegExp('\\b(?:' + [
    'threads?', 'zips?', 'zippers?', 'invisible zip', 'separating zip', 'buttons?',
    'snaps?', 'magnetic snaps?', 'press studs?', 'hook and eye', 'bra hooks?',
    'elastic', 'bias binding', 'bias tape', 'twill tape', 'interfacing', 'interlining',
    'fusing', 'fusible[a-z ]*', 'webbing', 'd-?rings?', 'o-?rings?', 'rectangle rings?',
    'swivel hooks?', 'swivel clasps?', 'triglides?', 'sliders?', 'rivets?', 'grommets?',
    'eyelets?', 'drawstrings?', 'cords?', 'cord stops?', 'toggles?', 'velcro',
    'hook-and-loop', 'boning', 'shoulder pads?', 'labels?', 'batting', 'wadding',
    'basting spray', 'safety pins?', 'walking foot', 'zipper foot', 'needles?',
    'rotary blades?', 'stabili[sz]ers?', 'shape ?flex', 'sf-?101', 'soft and stable'
  ].join('|') + ')\\b', 'i');

  var HARDWARE_RE = /\b(?:d-?rings?|o-?rings?|rectangle rings?|swivel hooks?|swivel clasps?|triglides?|sliders?|rivets?|grommets?|eyelets?|magnetic snaps?|snaps?|press studs?|hook and eye|bra hooks?|toggles?|cord stops?|buckles?|purse feet|bag feet)\b/i;
  var INTERFACING_RE = /\b(?:interfacing|interlining|fusing|fusible[a-z ]*|sf-?101|shape ?flex|soft and stable|stabili[sz]ers?|foam)\b/i;

  /**
   * 'TRIMS: 1x 25cm Invisible zip, fusing, either a button …' — a whole notions
   * list on one line after its label. Pattern Runway, Mood and most free
   * patterns do this instead of a bulleted block.
   */
  var NOTION_LABEL_RE = /^(trims?|notions?|supplies|haberdashery|hardware|materials?|you\s+will\s+need|what\s+you\s+will\s+need|tools?)\s*:\s*(\S.*)$/i;
  /** Any 'Label: text' line — used to stop an inline list running on. */
  var ANY_LABEL_RE = /^[A-Z][A-Za-z0-9 '&\/-]{1,36}:(?:\s|$)/;
  var INLINE_SPLIT_RE = /\s*[,;]\s*|\s+\+\s+|\.\s+(?=[A-Z0-9])/;
  var INLINE_LEAD_JUNK = /^(?:either\s+|a\s+|an\s+|some\s+|plus\s+|and\s+|or\s+)+/i;

  /** Split an inline notions list into items. Never splits 'Hook and eye'. */
  function splitInlineNotions(text) {
    var s = str(text, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').replace(/\.$/, '');
    if (!s) return [];
    var parts = s.split(INLINE_SPLIT_RE);
    // Only fall back to 'and'/'or' when there were no commas to go on, so that
    // 'Hook and eye' survives a comma-separated list intact.
    if (parts.length < 2) parts = s.split(/\s+(?:and|or)\s+/i);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = str(parts[i], '').replace(INLINE_LEAD_JUNK, '').replace(/^\s+|\s+$/g, '').replace(/[.,;]+$/, '');
      if (p.length < 2 || p.length > 90) continue;
      if (!/[a-z]/i.test(p)) continue;
      out.push(p);
      if (out.length >= 24) break;
    }
    return out;
  }

  var QTY_LEAD_X = /^\(?\s*(\d{1,3})\s*\)?\s*[x×]\s+/i;
  var QTY_PARENS = /^\(\s*(\d{1,3})\s*\)\s*/;
  var QTY_DASH = /^(\d{1,3})\s*[-—]\s+/;
  var QTY_WORD = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
  var QTY_TRAIL = /[x×]\s*(\d{1,3})\s*$/i;
  var QTY_PLAIN = /^(\d{1,3})\s+(?!(?:cm|mm|m|in|inch|inches|"|yd|yds|yards?|x|×)\b)[a-z]/i;

  function notionQty(text) {
    var s = str(text, '').replace(/^\s+|\s+$/g, '').replace(BULLET_RE, '');
    var m;
    if ((m = QTY_LEAD_X.exec(s))) return clampInt(m[1], 1, 999, null);
    if ((m = QTY_PARENS.exec(s))) return clampInt(m[1], 1, 999, null);
    if ((m = QTY_DASH.exec(s))) return clampInt(m[1], 1, 999, null);
    if ((m = QTY_WORD.exec(s))) return WORD_NUM[m[1].toLowerCase()] || null;
    if ((m = QTY_TRAIL.exec(s))) return clampInt(m[1], 1, 999, null);
    if ((m = QTY_PLAIN.exec(s))) return clampInt(m[1], 1, 999, null);
    return null;
  }

  // Words allowed to sit in front of the notion noun on a loose line.
  var LOOSE_LEAD = {
    x: 1, matching: 1, lightweight: 1, light: 1, heavyweight: 1, heavy: 1, medium: 1,
    invisible: 1, fusible: 1, coordinating: 1, separating: 1, clear: 1, metal: 1,
    plastic: 1, wide: 1, narrow: 1, cm: 1, mm: 1, m: 1, in: 1, inch: 1, inches: 1,
    yd: 1, yds: 1, yard: 1, yards: 1, of: 1, approx: 1
  };

  /**
   * Outside a notions block a line is only a notion when it *opens* with a
   * quantity or the notion noun itself. Without this, every glossary sentence
   * that mentions 'stitch' or 'thread' lands in the shopping list.
   */
  function looseNotion(text) {
    var s = str(text, '').replace(/^\s+|\s+$/g, '');
    if (!s || s.length > 60) return false;
    var m = NOTION_VOCAB.exec(s);
    NOTION_VOCAB.lastIndex = 0;
    if (!m) return false;
    var before = s.slice(0, m.index).toLowerCase().replace(/[^a-z0-9. ]+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!before) return true;
    var words = before.split(/\s+/);
    if (words.length > 6) return false;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      if (/^\d+(?:[.,]\d+)?$/.test(w)) continue;
      if (WORD_NUM[w]) continue;
      if (LOOSE_LEAD[w]) continue;
      return false;
    }
    return true;
  }

  function notionKind(text) {
    if (INTERFACING_RE.test(text)) return 'interfacing';
    if (HARDWARE_RE.test(text)) return 'hardware';
    return 'notion';
  }

  /**
   * parseNotions(lines, opts) -> NotionRow[]
   * opts.inBlock (default true): every non-heading 3-90 char line becomes a row.
   * opts.inBlock === false: only lines matching the notion vocabulary.
   */
  function parseNotions(input, opts) {
    opts = opts || {};
    var inBlock = opts.inBlock !== false;
    var lines = toLines(input);
    var out = [];
    var warns = [];
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.text;
      if (!t || ln.pageMark) continue;
      // A labelled inline list is allowed to be long; a plain line is not.
      var lab = NOTION_LABEL_RE.exec(t);
      if (lab) {
        // The list usually wraps onto the next printed line ('…13mm bias' /
        // 'binding'). Pull those in before splitting.
        var joined = lab[2];
        while (i + 1 < lines.length && joined.length < 400) {
          var nx = lines[i + 1];
          if (!nx || nx.pageMark || !nx.text) break;
          if (ANY_LABEL_RE.test(nx.text)) break;
          if (isHeading(nx.text)) break;
          joined += ' ' + nx.text;
          i++;
        }
        lab = [t, lab[1], joined];
      }
      if (!lab) {
        if (t.length < 3 || t.length > 90) continue;
        if (isHeading(t) && headingKind(headingText(t))) continue;
        if (/^[\d\s.\/"x×-]+$/.test(t)) continue;       // a bare measurement row
        if (!inBlock && !looseNotion(t)) continue;
        if (inBlock && stepMarker(t) && /^step/i.test(t.replace(BULLET_RE, ''))) continue;
      }

      // An inline list ('TRIMS: a, b, c') becomes one row per item.
      var items = null;
      if (lab) items = splitInlineNotions(lab[2]);
      else if (inBlock && t.indexOf(',') > 0 && t.length > 40) items = splitInlineNotions(t);
      if (!items || !items.length) items = [t.replace(BULLET_RE, '').replace(/\s*[.;]\s*$/, '').replace(/^\s+|\s+$/g, '')];

      for (var j = 0; j < items.length; j++) {
        var text = items[j];
        if (!text || text.length < 3) continue;
        var k = key(text);
        if (!k || seen[k]) continue;
        seen[k] = 1;
        out.push({
          text: text,
          qty: notionQty(text),
          kind: notionKind(text),
          line: t
        });
      }
    }
    Object.defineProperty(out, 'warnings', { value: warns, enumerable: false, configurable: true });
    return out;
  }

  // =====================================================================
  // 7. Seam allowance
  // =====================================================================

  var SA_UNIT = '(cm|mm|in|inch|inches|")';
  var SA_NUM = '([\\d]+(?:\\.\\d+)?(?:\\s+\\d+\\s*\\/\\s*\\d+)?|\\d+\\s*\\/\\s*\\d+)';
  var SA_RES = [
    new RegExp('seam allowances?\\s*(?:is|are|of|:|=)?\\s*\\(?\\s*' + SA_NUM + '\\s*' + SA_UNIT, 'i'),
    // '... with a 1/4" seam allowance', 'use a 1.5 cm (5/8") seam allowance'
    new RegExp(SA_NUM + '\\s*' + SA_UNIT + '\\s*(?:\\([^)]*\\)\\s*)?seam allowances?', 'i'),
    new RegExp('(?:all\\s+)?seams?\\s+(?:are|is)\\s+(?:sewn\\s+)?(?:at\\s+)?' + SA_NUM + '\\s*' + SA_UNIT, 'i'),
    new RegExp('seam allowances?\\s*[-\\u2014]\\s*' + SA_NUM + '\\s*' + SA_UNIT, 'i')
  ];
  var SA_BRACKET = new RegExp('\\(\\s*' + SA_NUM + '\\s*' + SA_UNIT + '\\s*\\)', 'i');
  var SA_DUAL = new RegExp(SA_NUM + '\\s*' + SA_UNIT + '\\s*\\/\\s*' + SA_NUM + '\\s*' + SA_UNIT, 'i');
  var SA_INCLUDED = /seam allowances?\s+(?:are|is)\s+(not\s+included|included)/i;
  var SA_EXCEPT_SPLIT = /\b(besides|except(?:\s+for)?|apart from|other than|excluding)\b/i;
  // Deliberately narrow: a later sentence only counts as an exception when it
  // says so. 'at the' alone matched half the construction steps.
  var SA_EXCEPT_WORDS = /\b(except|besides|apart from|other than|excluding)\b/i;
  var SA_ANY = new RegExp(SA_NUM + '\\s*' + SA_UNIT, 'i');
  var SA_MENTION = /seam allowance|seams? are|seams? is|sewn at|stitch at/i;

  var DOT_MARK = '';
  var SA_STOP_LINE = /^(?:size\s*chart|sizes?\b|finished\b|fabric\b|yardage\b|cutting\b|notions?\b|trims?\b|materials?\b|supplies\b|measurements?\b)/i;

  /**
   * Split into statement-sized chunks. A heading, a 'Label:' line or a
   * heading-ish word at the start of a line ends the chunk even without a full
   * stop — otherwise a seam-allowance sentence with no period swallows the
   * whole size chart and fabric table beneath it.
   */
  function saSegments(text) {
    var lines = str(text, '').split('\n');
    var out = [];
    var buf = [];
    function flush() {
      if (buf.length) out.push(buf.join(' '));
      buf = [];
    }
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/^\s+|\s+$/g, '');
      if (!t || PAGE_RE.test(t)) { flush(); continue; }
      if (ANY_LABEL_RE.test(t) || SA_STOP_LINE.test(t) || isHeading(t)) {
        flush();
        buf.push(t);
        flush();
        continue;
      }
      buf.push(t);
      if (buf.join(' ').length > 1200) flush();
    }
    flush();
    return out;
  }

  function splitSentences(text) {
    var segments = saSegments(text);
    var out = [];
    for (var s = 0; s < segments.length; s++) {
      // protect decimal points so '1.5 cm' is not two sentences
      var flat = segments[s].replace(/(\d)\.(\d)/g, '$1' + DOT_MARK + '$2');
      var re = /[^.!?•]+[.!?]?/g;
      var m;
      while ((m = re.exec(flat))) {
        var one = m[0].split(DOT_MARK).join('.').replace(/^\s+|\s+$/g, '');
        if (one) out.push(one.slice(0, 200));
        if (out.length > 4000) return out;
      }
    }
    return out;
  }

  function saMeasure(sentence) {
    for (var i = 0; i < SA_RES.length; i++) {
      var m = SA_RES[i].exec(sentence);
      if (m) return { value: m[1], unit: m[2].toLowerCase() };
    }
    return null;
  }

  function saObject(sentence, primary) {
    var mm = toMm(primary.value, primary.unit);
    var inches = isImperial(primary.unit) ? primary.value.replace(/\s+/g, ' ') : null;
    var br = SA_BRACKET.exec(sentence);
    if (br) {
      var bu = br[2].toLowerCase();
      if (isImperial(bu) && !inches) inches = br[1].replace(/\s+/g, ' ');
      if (!isImperial(bu) && mm === null) mm = toMm(br[1], bu);
    }
    // '1.5cm / 5/8"' — the dual-unit slash form, which is what most European
    // and Australian patterns print instead of brackets.
    var du = SA_DUAL.exec(sentence);
    if (du) {
      var u1 = du[2].toLowerCase(), u2 = du[4].toLowerCase();
      if (isImperial(u1) && !inches) inches = du[1].replace(/\s+/g, ' ');
      if (isImperial(u2) && !inches) inches = du[3].replace(/\s+/g, ' ');
      if (mm === null && !isImperial(u1)) mm = toMm(du[1], u1);
      if (mm === null && !isImperial(u2)) mm = toMm(du[3], u2);
    }
    return { mm: mm, inches: inches };
  }

  /**
   * parseSeamAllowance(text, kind?) -> { text, mm, inches, included, exceptions } | null
   * `kind === 'quilt'` with nothing found returns the 1/4" quilting standard.
   */
  function parseSeamAllowance(text, kind) {
    var t = normalizeText(str(text, ''));
    var sentences = splitSentences(t);
    var main = null, mainSentence = '', includedSentence = '';
    var exceptions = [];
    var included = null;

    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i];
      if (!SA_MENTION.test(s)) continue;
      var inc = SA_INCLUDED.exec(s);
      if (inc && included === null) {
        included = !/not/i.test(inc[1]);
        includedSentence = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      }

      // 'All seams are 1/2" besides the collar, which is sewn at 3/8"' - one sentence, two values.
      var head = s, tail = '';
      var sp = SA_EXCEPT_SPLIT.exec(s);
      if (sp) { head = s.slice(0, sp.index); tail = s.slice(sp.index); }

      var mHead = saMeasure(head);
      if (!main && mHead) {
        main = saObject(head, mHead);
        mainSentence = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      } else if (main && mHead && SA_EXCEPT_WORDS.test(s) && toMm(mHead.value, mHead.unit) !== main.mm) {
        // A later sentence that simply restates the same allowance ("Seam
        // allowances for all wovens are 1.5cm unless otherwise indicated") is
        // not an exception.
        addException(exceptions, s, mHead);
      }
      if (tail) {
        var mTail = saMeasure(tail) || (SA_ANY.exec(tail) ? { value: SA_ANY.exec(tail)[1], unit: SA_ANY.exec(tail)[2].toLowerCase() } : null);
        if (mTail) addException(exceptions, tail.replace(/^\s*(?:,\s*)?/, ''), mTail);
      }
    }

    if (!main) {
      if (included !== null) {
        // 'Seam allowances are included' with no measurement is still worth keeping.
        return { text: includedSentence, mm: null, inches: null, included: included, exceptions: exceptions };
      }
      if (kind === 'quilt') {
        return {
          text: 'Quilting standard — 1/4"',
          mm: 6, inches: '1/4', included: null, exceptions: [], assumed: true
        };
      }
      return null;
    }
    return {
      text: mainSentence,
      mm: main.mm,
      inches: main.inches,
      included: included,
      exceptions: exceptions
    };
  }

  function addException(list, sentence, measure) {
    var t = str(sentence, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').replace(/^[,\s]+/, '');
    if (!t) return;
    for (var i = 0; i < list.length; i++) if (key(list[i].text) === key(t)) return;
    if (list.length >= 8) return;
    list.push({ text: t, mm: toMm(measure.value, measure.unit) });
  }

  // =====================================================================
  // 8. Sizes + fabric requirements
  // =====================================================================

  var SIZE_TOKEN_RE = /^(?:x{0,3}s|s|m|l|x{0,3}l|\d{1,2}\s*x[sl]?|[a-j]|\d{1,2})$/i;

  // 'Size Chart:', 'Size Chart:(cm)', 'Sizes -', 'Finished Garment Measurements:'
  var SIZE_PREFIX_RE = /^(?:size\s*(?:chart|range|guide)?|sizes|finished(?:\s+garment)?(?:\s+measurements?)?|measurements?|body\s+measurements?)\s*[:.\-]?\s*(?:\(\s*(cm|mm|in|inch(?:es)?)\s*\)\s*)?[:.\-]?\s*/i;

  /** The unit a size-chart header declares in brackets, or ''. */
  function sizeHeaderUnit(text) {
    var m = SIZE_PREFIX_RE.exec(str(text, '').replace(/^\s+|\s+$/g, ''));
    if (!m || !m[1]) return '';
    var u = m[1].toLowerCase();
    return (u === 'in' || u === 'inch' || u === 'inches') ? 'inch' : u;
  }

  /** A size-chart header line -> labels[], else null. */
  function sizeHeader(text) {
    var s = str(text, '').replace(/^\s+|\s+$/g, '').replace(SIZE_PREFIX_RE, '').replace(/[|,\/]/g, ' ');
    if (!s) return null;
    var toks = s.split(/\s+/).filter(Boolean);
    if (toks.length < 3 || toks.length > 24) return null;
    var nums = [];
    for (var i = 0; i < toks.length; i++) {
      if (!SIZE_TOKEN_RE.test(toks[i])) return null;
      if (/^\d{1,2}$/.test(toks[i])) {
        var v = parseInt(toks[i], 10);
        if (v > 60) return null;
        nums.push(v);
      }
    }
    if (nums.length === toks.length) {
      // all numeric: require a constant, meaningful step so figure numbers are not charts
      if (toks.length < 4) return null;
      var step = nums[1] - nums[0];
      if (step < 1) return null;
      if (step < 2 && toks.length < 5) return null;
      for (var j = 2; j < nums.length; j++) if (nums[j] - nums[j - 1] !== step) return null;
    } else {
      for (var k = 1; k < nums.length; k++) if (nums[k] <= nums[k - 1]) return null;
    }
    return toks.map(function (t) { return t.toUpperCase(); });
  }

  var LABEL_MAP = {
    bust: 'Bust', chest: 'Bust', 'full bust': 'Bust', waist: 'Waist',
    hip: 'Hip', hips: 'Hip', 'high hip': 'High hip', height: 'Height',
    'back length': 'Back length', 'back waist length': 'Back length',
    inseam: 'Inseam', 'sleeve length': 'Sleeve length', sleeve: 'Sleeve length',
    'upper arm': 'Upper arm', 'bicep': 'Upper arm', neck: 'Neck',
    'finished bust': 'Finished bust', 'finished length': 'Finished length', length: 'Length'
  };

  function normLabel(s) {
    var t = str(s, '').replace(/[:.\-—]+$/, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var m = LABEL_MAP[t.toLowerCase()];
    return m || t;
  }

  // No leading \b: '84cm/33"' has no word boundary before 'cm', and that dual
  // unit cell is exactly what Pattern Runway prints in its size charts.
  var UNIT_WORD_RE = /(?:cm|mm|inches|inch|in|yards|yard|yds|yd|m)(?![a-z])/gi;
  var FRACTION_TOKEN_RE = /^\d{1,2}\s*\/\s*\d{1,2}["’']?$/;
  // A token that *starts* with a unit, so it belongs to the number before it:
  // '86.5' + 'cm/34"' is one cell, not two.
  var UNIT_TAIL_RE = /^(?:cm|mm|m|in|inch(?:es)?|yds?|yards?|")(?:[\/\-]|$|")/i;

  /** True when the token is only digits, punctuation and unit words. */
  function isValueToken(t) {
    if (!/^\d/.test(t)) return false;
    var rest = String(t).replace(UNIT_WORD_RE, '').replace(/[\d.,\/–\-"'\s]/g, '');
    UNIT_WORD_RE.lastIndex = 0;
    return rest === '';
  }

  /**
   * Split a measurement row's values into one token per size. Handles
   * '33 1/2"' (fraction split off by the glyph pass) and the dual-unit cells
   * Pattern Runway prints: '84cm/33"  86.5 cm/34"  89 cm/35"'.
   */
  function valueTokens(s) {
    var raw = str(s, '').replace(/[|]/g, ' ').split(/\s+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var tok = raw[i];
      // glue on any number of trailing fraction / unit-tail pieces
      while (i + 1 < raw.length) {
        var next = raw[i + 1];
        if (/\d$/.test(tok) && FRACTION_TOKEN_RE.test(next)) { tok += ' ' + next; i++; continue; }
        if (/[\d.]$/.test(tok) && UNIT_TAIL_RE.test(next)) { tok += ' ' + next; i++; continue; }
        break;
      }
      out.push(tok);
    }
    return out;
  }

  var MEASURE_ROW_RE = /^([A-Za-z][A-Za-z ()'\/-]{0,28}?)\s*[:\-—]?\s+([\d].*)$/;

  function measureRows(lines, start, labels, limit) {
    var rows = [];
    var blanks = 0;
    var prevText = '';
    for (var i = start; i < lines.length && rows.length < (limit || 12); i++) {
      var ln = lines[i];
      var t = ln.text;
      if (ln.pageMark) break;
      if (!t) { blanks++; if (blanks >= 2) break; continue; }
      if (isHeading(t) && headingKind(headingText(t))) break;

      var label = '', valuePart = '';
      var m = MEASURE_ROW_RE.exec(t);
      if (m) {
        label = m[1];
        valuePart = m[2];
      } else if (/^\d/.test(t) && prevText && prevText.length <= 28 && /^[A-Za-z][A-Za-z ()'\/-]*$/.test(prevText)) {
        // The label printed on its own line above the values, which is what a
        // wrapped table cell ('Finished' / values / 'Length') comes out as.
        label = prevText;
        valuePart = t;
      } else {
        prevText = t;
        if (rows.length) break;
        continue;
      }

      var vals = valueTokens(valuePart);
      var ok = vals.length === labels.length;
      if (ok) {
        for (var v = 0; v < vals.length; v++) if (!isValueToken(vals[v])) { ok = false; break; }
      }
      if (!ok) { prevText = t; if (rows.length) break; else continue; }
      blanks = 0;
      prevText = t;
      rows.push({ label: normLabel(label), values: vals });
    }
    return rows;
  }

  /** parseSizes(lines) -> { labels, chart, finished } | null, with `.warnings`. */
  function parseSizes(input) {
    var lines = toLines(input);
    var warns = [];
    var labels = null, chart = [], finished = [];
    var lastHead = '';
    var found = 0;
    var unit = '', chartUnit = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.text;
      if (!t || ln.pageMark) continue;
      // a size row ('XS S M L XL') also reads as an ALL CAPS heading, so test it first
      var hdr = sizeHeader(t);
      if (!hdr) {
        if (isHeading(t)) lastHead = headingText(t);
        continue;
      }
      var thisUnit = sizeHeaderUnit(t) || sizeHeaderUnit(lastHead);
      var rows = measureRows(lines, i + 1, hdr, 12);
      if (!rows.length) { if (!labels) warns.push('A size row was found but no measurements lined up with it.'); continue; }
      var isFinished = /finish/i.test(lastHead) || /finish/i.test(t);
      if (!labels) { labels = hdr; unit = thisUnit; }
      if (hdr.length !== labels.length) continue;
      if (isFinished) {
        finished = finished.concat(rows);
      } else if (!chart.length) {
        chart = rows;
        chartUnit = thisUnit || unit;
      } else if (thisUnit && chartUnit && thisUnit !== chartUnit) {
        // The same chart repeated in the other unit ('Size Chart:(inch)').
        // One table is enough; the values stay verbatim either way.
        found++;
        i += rows.length;
        continue;
      } else {
        finished = finished.concat(rows);
      }
      found++;
      i += rows.length;
      if (found >= 4) break;
    }
    if (!labels) {
      warns.push('No size chart found — add your size by hand.');
      var nullOut = null;
      return nullOut;
    }
    var out = { labels: labels, chart: chart, finished: finished, unit: chartUnit || unit || '' };
    Object.defineProperty(out, 'warnings', { value: warns, enumerable: false, configurable: true });
    return out;
  }

  // A width, optionally in both units: '115 cm', '45"', '150cm / 60"'.
  var WIDTH_RE = /\b(\d{2,3})\s*(cm|"|in\b|inch(?:es)?)\s*(?:\/\s*(\d{2,3})\s*(cm|"|in\b|inch(?:es)?))?\s*(?:wide|width)?/i;
  var WIDTH_RE_G = new RegExp(WIDTH_RE.source, 'gi');
  // The bolt widths fabric is actually sold in, in inches.
  var COMMON_WIDTHS = { 36: 1, 42: 1, 44: 1, 45: 1, 54: 1, 58: 1, 59: 1, 60: 1, 72: 1 };
  var AMOUNT_RE = /\b\d{1,2}(?:\.\d+)?(?:\s+\d+\/\d+)?\s*(?:m\b|cm\b|yds?\b|yards?\b|")|\b\d+\/\d+\s*(?:m\b|yds?\b|yards?\b|")/gi;

  /**
   * Every plausible bolt width on a line. '1m / 40"' is a yardage, not a
   * width, so an imperial value has to be one the trade actually sells.
   */
  function widthsIn(text) {
    var out = [];
    var w;
    WIDTH_RE_G.lastIndex = 0;
    while ((w = WIDTH_RE_G.exec(str(text, '')))) {
      var wv = parseInt(w[1], 10);
      var ok = isImperial(w[2]) ? !!COMMON_WIDTHS[wv] : (wv >= 60 && wv <= 300);
      if (ok) {
        out.push({
          text: w[0].replace(/\s*(?:wide|width)\s*$/i, '').replace(/^\s+|\s+$/g, ''),
          at: w.index,
          end: w.index + w[0].length
        });
      }
      if (out.length >= 6) break;
    }
    WIDTH_RE_G.lastIndex = 0;
    return out;
  }

  /** parseFabric(lines, labels) -> FabricRow[] */
  function parseFabric(input, labels) {
    var lines = toLines(input);
    var wanted = isArr(labels) ? labels.length : 0;
    var out = [];
    var lastName = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.text;
      if (!t || ln.pageMark) continue;
      if (isHeading(t)) { lastName = prettyHeading(headingText(t)); continue; }
      // A line can carry more than one width: 'Wide Fabric: 150cm / 60"
      // Narrow Fabric: 115cm / 45"'. Each becomes its own row.
      var found = widthsIn(t);

      if (!found.length) {
        if (t.length <= 40 && /[a-z]/i.test(t) && !AMOUNT_RE.test(t)) lastName = t.replace(/[:\-—]\s*$/, '');
        AMOUNT_RE.lastIndex = 0;
        continue;
      }

      var tail = t.slice(found[found.length - 1].end);
      var amounts = matchAll(tail, AMOUNT_RE);
      var consumedNext = false;
      if (!amounts.length && i + 1 < lines.length && lines[i + 1].text) {
        // The amounts often sit on the line under the widths.
        var nxt = matchAll(lines[i + 1].text, AMOUNT_RE);
        if (nxt.length && !widthsIn(lines[i + 1].text).length) { amounts = nxt; consumedNext = true; }
      }
      var raw = amounts.slice();
      if (found.length > 1 || (wanted && amounts.length !== wanted)) amounts = [];

      for (var f = 0; f < found.length; f++) {
        var from = f === 0 ? 0 : found[f - 1].end;
        var name = t.slice(from, found[f].at).replace(/[:\-—,]\s*$/, '').replace(/^[\s\-—:,\/]+/, '').replace(/^\s+|\s+$/g, '');
        if (!name) name = lastName || 'Fabric';
        out.push({
          name: name,
          width: found[f].text,
          amounts: amounts,
          rawAmounts: raw,
          note: '',
          line: consumedNext ? (t + ' ' + lines[i + 1].text) : t
        });
        if (out.length >= 40) break;
      }
      if (consumedNext) i++;
      if (out.length >= 40) break;
    }
    return out;
  }

  function matchAll(s, re) {
    var out = [];
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(str(s, '')))) {
      out.push(m[0].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''));
      if (out.length > 40) break;
    }
    re.lastIndex = 0;
    return out;
  }

  // =====================================================================
  // 9. Meta, kind detection, quilt unit counters
  // =====================================================================

  var QUILT_SIGNS = [/\bWOF\b/, /\bwidth of fabric\b/i, /\bstrips?\b/i, /\bbinding\b/i, /\bbacking\b/i, /\bbatting\b/i, /\bfat quarters?\b/i, /\bblocks?\b/i, /\bsashing\b/i];
  var BAG_SIGNS = [/\blining\b/i, /\binterfacing\b/i, /\bd-?rings?\b/i, /\bswivel\b/i, /\bmagnetic snap\b/i, /\bzips?\b|\bzippers?\b/i, /\bstraps?\b/i, /\bgussets?\b/i, /\bwebbing\b/i];
  var GARMENT_SIGNS = [/\bbodice\b/i, /\bsleeves?\b/i, /\bhem(?:s|ming|line)?\b/i, /\bdarts?\b/i, /\bfacings?\b/i, /\bwaistband\b/i, /\bcollars?\b/i, /\bneckline\b/i, /\barmholes?\b/i, /\bcuffs?\b/i];

  function countSigns(text, list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].test(text)) n++;
    return n;
  }

  /** detectKind(text, hasSizeChart) -> 'garment'|'bag'|'quilt'|'unknown' */
  function detectKind(text, hasSizeChart) {
    var t = str(text, '');
    if (!t) return 'unknown';
    var q = countSigns(t, QUILT_SIGNS);
    var b = countSigns(t, BAG_SIGNS);
    // A garment booklet almost always mentions a zip and interfacing too, which would
    // otherwise be enough to call it a bag - so garment evidence has to compete.
    var g = countSigns(t, GARMENT_SIGNS) + (hasSizeChart ? 1 : 0);
    if (q >= 2 && q >= b && q >= g) return 'quilt';
    if (b >= 2 && b >= q && b > g) return 'bag';
    if (g >= 1) return 'garment';
    if (q >= 2) return 'quilt';
    if (b >= 2) return 'bag';
    return 'unknown';
  }

  var UNIT_RE = /(\d{2,4})\s+(flying geese|half[\s-]square triangles|hsts?|quarter[\s-]square triangles|qsts?|blocks|squares|units|hexies|triangles)\b/gi;

  /** parseUnits(text) -> [{ id, name, target, done }] - quilt block counters. */
  function parseUnits(text) {
    var t = normalizeText(str(text, ''));
    var out = [];
    var byName = {};
    var m;
    UNIT_RE.lastIndex = 0;
    while ((m = UNIT_RE.exec(t))) {
      var target = parseInt(m[1], 10);
      if (!target || target < 4 || target > 9999) continue;
      var name = titleCase(m[2].replace(/\s+/g, ' '));
      var k = key(name);
      if (byName[k]) {
        if (target > byName[k].target) byName[k].target = target;
        continue;
      }
      var row = { id: uid('u'), name: name, target: target, done: 0 };
      byName[k] = row;
      out.push(row);
      if (out.length >= 8) break;
    }
    UNIT_RE.lastIndex = 0;
    return out;
  }

  var COPYRIGHT_RE = /(?:©|\(c\)|copyright)\s*(?:\d{4}\s*)?([A-Z][^\n©|]{2,40}?)\s*(?:\d{4})?\s*$/gim;
  var VERSION_RE = /\b(?:v(?:ersion)?\s*\.?\s*)(\d+(?:\.\d+)?)\b/i;
  var VIEW_RE = /\bview\s+([A-Z])\b/g;
  var NAME_SKIP_RE = /^(?:instructions?|sewing pattern|pattern|contents|page \d+|https?:|www\.|©|copyright|all rights reserved)/i;
  var NAME_HINT_RE = /\b(top|shirt|dress|tank|tee|jacket|coat|bag|tote|pouch|quilt|skirt|pants|trousers|shorts|blouse|jumpsuit|robe|hoodie|sweater|cardigan|vest|apron|backpack|sling|wallet|cushion|pillow)\b/i;

  var DESIGNER_STOP = /^(?:and|the|to|of|in|for|by|this|that|it|is|are|be|with|from|or|all|any|no|not|its|their|our|your|info|information|copyright|reserved|rights|use|only|pattern|patterns|free)\b/i;
  var DOMAIN_RE = /(?:www\.|https?:\/\/)([a-z0-9][a-z0-9-]{2,30})\.(?:com|net|org|co|co\.uk|com\.au|nz|de|fr)\b/i;

  /** Is this capture a plausible business name rather than a sentence tail? */
  function goodDesigner(name) {
    if (!name || name.length < 3 || name.length > 40) return false;
    if (/[:;|]/.test(name)) return false;
    if (/^\d+$/.test(name)) return false;
    if (DESIGNER_STOP.test(name)) return false;
    if (!/^[A-Z]/.test(name)) return false;
    var words = name.split(/\s+/);
    if (words.length > 4) return false;
    for (var i = 0; i < words.length; i++) {
      if (DESIGNER_STOP.test(words[i]) && i === 0) return false;
    }
    return true;
  }

  /**
   * The brand behind 'www.patternrunway.com' written out as 'Pattern Runway'.
   * Far more reliable than the copyright line, which is usually a sentence.
   */
  function designerFromDomain(text) {
    var d = DOMAIN_RE.exec(text);
    if (!d) return '';
    var want = d[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (want.length < 4) return '';
    var re = /\b([A-Z][A-Za-z]{1,18})(?:\s+([A-Z][A-Za-z]{1,18}))?(?:\s+([A-Z][A-Za-z]{1,18}))?\b/g;
    var m;
    var guard = 0;
    while ((m = re.exec(text)) && guard++ < 4000) {
      for (var n = 3; n >= 1; n--) {
        var parts = [];
        for (var p = 1; p <= n; p++) if (m[p]) parts.push(m[p]);
        if (parts.length !== n) continue;
        if (parts.join('').toLowerCase() === want) return parts.join(' ');
      }
    }
    return '';
  }

  function parseMeta(lines, fullText) {
    var meta = { designer: '', patternName: '', version: '', views: [] };
    // designer: the most repeated copyright footer
    var counts = {}, best = '', bestN = 0, m;
    COPYRIGHT_RE.lastIndex = 0;
    while ((m = COPYRIGHT_RE.exec(fullText))) {
      var name = m[1].replace(/[\s.,|-]+$/, '').replace(/^\s+|\s+$/g, '');
      if (!goodDesigner(name)) continue;
      counts[name] = (counts[name] || 0) + 1;
      if (counts[name] > bestN) { bestN = counts[name]; best = name; }
    }
    COPYRIGHT_RE.lastIndex = 0;
    if (!best) best = designerFromDomain(fullText);
    meta.designer = best;

    // pattern name: the strongest headline-looking line on the first page
    var bestName = '', bestScore = 0;
    for (var i = 0; i < lines.length && i < 40; i++) {
      var t = lines[i].text;
      if (!t || lines[i].pageMark) continue;
      if (lines[i].page !== null && lines[i].page > 1) break;
      if (t.length < 3 || t.length > 48) continue;
      if (NAME_SKIP_RE.test(t)) continue;
      if (headingKind(headingText(t))) continue;
      if (/[.!?]$/.test(t)) continue;
      var score = 0;
      if (!/[a-z]/.test(t)) score += 2;
      else if (/^[A-Z]/.test(t)) score += 1;
      if (NAME_HINT_RE.test(t)) score += 3;
      if (t.split(/\s+/).length <= 5) score += 1;
      if (i < 12) score += 1;
      if (score > bestScore) { bestScore = score; bestName = t; }
    }
    meta.patternName = bestName
      .replace(/\s*[-—|]\s*(?:instructions?|sewing pattern|pattern)\s*$/i, '')
      .replace(/^\s+|\s+$/g, '');

    var vm = VERSION_RE.exec(fullText);
    if (vm) meta.version = 'v' + vm[1];

    VIEW_RE.lastIndex = 0;
    var seen = {};
    while ((m = VIEW_RE.exec(fullText))) {
      var v = 'View ' + m[1].toUpperCase();
      if (seen[v]) continue;
      seen[v] = 1;
      meta.views.push(v);
      if (meta.views.length >= 8) break;
    }
    VIEW_RE.lastIndex = 0;
    meta.views.sort();
    return meta;
  }

  // =====================================================================
  // 10. parse()
  // =====================================================================

  function emptyParse() {
    return {
      meta: { designer: '', patternName: '', version: '', views: [] },
      sizes: null,
      fabric: [],
      notions: [],
      cuttingList: [],
      steps: [],
      units: [],
      seamAllowance: null,
      kind: 'unknown',
      pages: 0,
      sourceText: '',
      warnings: []
    };
  }

  var STRONG_CUT_RE = /^(?:sub-?\s?cut\b|\(?\d{1,3}\)?\s+strips?\b|from\s+.{2,40}?[,:]\s*cut\b)/i;

  /**
   * Sewing.parse(text, opts) -> SewingParse. Never throws.
   * opts = { units: 'auto'|'metric'|'imperial', craftHint: 'garment'|'bag'|'quilt'|null,
   *          columns: number, fallbackSteps: boolean }
   */
  function parse(text, opts) {
    opts = opts || {};
    var res = emptyParse();
    var raw = typeof text === 'string' ? text : '';
    if (!raw || !raw.replace(/\s/g, '')) {
      res.warnings.push('There was no text to read — the pattern may be scanned images.');
      return res;
    }

    var norm = '';
    try { norm = normalizeText(raw); } catch (e0) { norm = raw; res.warnings.push('The text could not be tidied up.'); }
    res.sourceText = norm;

    var lines = [];
    try { lines = toLines(norm); } catch (e1) { res.warnings.push('The text could not be split into lines.'); }

    var pages = 0;
    for (var p = 0; p < lines.length; p++) {
      if (typeof lines[p].page === 'number' && lines[p].page > pages) pages = lines[p].page;
    }
    res.pages = pages || (lines.length ? 1 : 0);

    var info;
    try { info = classify(lines); } catch (e2) {
      info = { kinds: [], heads: [] };
      res.warnings.push('The pattern\'s sections could not be worked out.');
    }
    var kinds = info.kinds, heads = info.heads;

    // --- sizes (needed before fabric, which aligns to the size labels) -----
    try {
      var sizes = parseSizes(lines);
      if (sizes) {
        res.sizes = { labels: sizes.labels, chart: sizes.chart, finished: sizes.finished, unit: sizes.unit || '' };
        if (sizes.warnings) sizes.warnings.forEach(function (w) { pushUnique(res.warnings, w); });
      } else {
        pushUnique(res.warnings, 'No size chart found — add your size by hand.');
      }
    } catch (e3) { pushUnique(res.warnings, 'The size chart could not be read.'); }

    // --- kind ---------------------------------------------------------------
    try {
      res.kind = (opts.craftHint && /^(garment|bag|quilt)$/.test(opts.craftHint))
        ? opts.craftHint
        : detectKind(norm, !!res.sizes);
    } catch (e4) { res.kind = 'unknown'; }

    // --- steps --------------------------------------------------------------
    var firstStepIndex = -1;
    try {
      var steps = parseSteps(lines, { blocks: info, columns: opts.columns, fallback: !!opts.fallbackSteps });
      res.steps = Array.prototype.slice.call(steps);
      firstStepIndex = typeof steps.firstIndex === 'number' ? steps.firstIndex : -1;
      if (steps.warnings) steps.warnings.forEach(function (w) { pushUnique(res.warnings, w); });
    } catch (e5) { pushUnique(res.warnings, 'The steps could not be read.'); }

    // --- cutting list -------------------------------------------------------
    try {
      var cutLines = [];
      for (var c = 0; c < lines.length; c++) {
        if (kinds[c] === 'cut') { cutLines.push(lines[c]); continue; }
        if (kinds[c] === 'head' && headingKind(heads[c]) === 'cut') { cutLines.push(lines[c]); continue; }
        var ct = lines[c].text;
        if (!ct) continue;
        if (STRONG_CUT_RE.test(ct)) { cutLines.push(lines[c]); continue; }
        if (firstStepIndex >= 0 && c > firstStepIndex) continue;
        if (kinds[c] === 'none' && /^cut\b/i.test(ct)) cutLines.push(lines[c]);
      }
      res.cuttingList = Array.prototype.slice.call(parseCutting(cutLines));
      if (!res.cuttingList.length) pushUnique(res.warnings, 'No cutting list found — add the pieces yourself.');
    } catch (e6) { pushUnique(res.warnings, 'The cutting list could not be read.'); }

    // --- notions ------------------------------------------------------------
    try {
      var blockLines = [], looseLines = [];
      for (var n = 0; n < lines.length; n++) {
        if (kinds[n] === 'notions') blockLines.push(lines[n]);
        else if (kinds[n] === 'none' && (firstStepIndex < 0 || n < firstStepIndex)) looseLines.push(lines[n]);
      }
      var notions = Array.prototype.slice.call(parseNotions(blockLines, { inBlock: true }));
      var loose = parseNotions(looseLines, { inBlock: false });
      var have = {};
      notions.forEach(function (r) { have[key(r.text)] = 1; });
      for (var l = 0; l < loose.length; l++) {
        if (have[key(loose[l].text)]) continue;
        have[key(loose[l].text)] = 1;
        notions.push(loose[l]);
      }
      res.notions = notions;
      if (!res.notions.length) pushUnique(res.warnings, 'No notions list found — add what you need yourself.');
    } catch (e7) { pushUnique(res.warnings, 'The notions list could not be read.'); }

    // --- seam allowance -----------------------------------------------------
    try {
      var sa = parseSeamAllowance(norm, res.kind);
      if (sa) {
        if (sa.assumed) {
          delete sa.assumed;
          pushUnique(res.warnings, 'No seam allowance stated — assumed the quilting standard 1/4".');
        }
        res.seamAllowance = sa;
      } else {
        pushUnique(res.warnings, 'No seam allowance found — check the pattern.');
      }
    } catch (e8) { pushUnique(res.warnings, 'The seam allowance could not be read.'); }

    // --- fabric requirements ------------------------------------------------
    try {
      var fabLines = [];
      for (var f = 0; f < lines.length; f++) {
        if (kinds[f] === 'fabric' || (kinds[f] === 'head' && headingKind(heads[f]) === 'fabric')) fabLines.push(lines[f]);
      }
      res.fabric = parseFabric(fabLines, res.sizes ? res.sizes.labels : null);
    } catch (e9) { pushUnique(res.warnings, 'The fabric requirements could not be read.'); }

    // --- quilt unit counters ------------------------------------------------
    try {
      if (res.kind === 'quilt') res.units = parseUnits(norm);
    } catch (e10) { /* counters are a bonus; never warn */ }

    // --- meta ---------------------------------------------------------------
    try { res.meta = parseMeta(lines, norm); } catch (e11) { pushUnique(res.warnings, 'The pattern name could not be read.'); }

    if (res.warnings.length > 20) res.warnings = res.warnings.slice(0, 20);
    return res;
  }

  // =====================================================================
  // 11. craftData: normalize / toCraftData / summary / templates
  // =====================================================================

  var SOURCE_CAP = 60000;

  // Page images (research A.3.4): rendered from the PDF into BlobStore, opt-in,
  // capped so a 90-page booklet cannot fill the device. They are a CACHE, never
  // the source of truth: the steps' text lives in localStorage and the images
  // may be evicted at any time.
  var PAGE_CAP = 40;

  function emptyData() {
    return {
      meta: { designer: '', patternName: '', version: '', view: '', url: '' },
      size: { chosen: '', sizeLabels: [], alterations: '', unit: '' },
      measurements: { body: [], finished: [], mine: [] },
      fabric: [],
      notions: [],
      cutting: [],
      steps: [],
      currentStep: 0,
      pages: [],
      units: [],
      seamAllowance: null,
      machine: { needle: '', thread: '', stitchLength: '', tension: '', presserFoot: '', notes: '' },
      sourceText: '',
      warnings: []
    };
  }

  function normStrArray(v, max, cap) {
    var out = [];
    if (!isArr(v)) return out;
    for (var i = 0; i < v.length && out.length < (max || 64); i++) {
      var s = str(v[i], '').replace(/^\s+|\s+$/g, '');
      if (s) out.push(cap ? s.slice(0, cap) : s);
    }
    return out;
  }

  function normMeasureRows(v) {
    var out = [];
    if (!isArr(v)) return out;
    for (var i = 0; i < v.length && out.length < 40; i++) {
      var r = v[i];
      if (!isObj(r)) continue;
      var label = str(r.label, '').replace(/^\s+|\s+$/g, '').slice(0, 40);
      if (!label) continue;
      out.push({ label: label, values: normStrArray(r.values, 32, 24) });
    }
    return out;
  }

  function normSeamAllowance(v) {
    if (!isObj(v)) return null;
    var mm = (typeof v.mm === 'number' && isFinite(v.mm)) ? clampInt(v.mm, 0, 500, null) : null;
    var exceptions = [];
    if (isArr(v.exceptions)) {
      for (var i = 0; i < v.exceptions.length && exceptions.length < 8; i++) {
        var e = v.exceptions[i];
        if (!isObj(e)) continue;
        var t = str(e.text, '').replace(/^\s+|\s+$/g, '').slice(0, 200);
        if (!t) continue;
        exceptions.push({ text: t, mm: (typeof e.mm === 'number' && isFinite(e.mm)) ? clampInt(e.mm, 0, 500, null) : null });
      }
    }
    var text = str(v.text, '').slice(0, 300);
    if (!text && mm === null && !exceptions.length) return null;
    return {
      text: text,
      mm: mm,
      inches: typeof v.inches === 'string' && v.inches ? v.inches.slice(0, 20) : null,
      included: v.included === true ? true : (v.included === false ? false : null),
      exceptions: exceptions
    };
  }

  /**
   * Sewing.normalize(raw, project) -> SewingData. Never throws; repairs every field.
   * Called by Store on load/import via registerCraft.
   */
  function normalizeData(raw, project) {
    var d = emptyData();
    try {
      if (!isObj(raw)) return d;

      if (isObj(raw.meta)) {
        d.meta.designer = str(raw.meta.designer, '').slice(0, 80);
        d.meta.patternName = str(raw.meta.patternName, '').slice(0, 80);
        d.meta.version = str(raw.meta.version, '').slice(0, 20);
        d.meta.view = str(raw.meta.view, '').slice(0, 40);
        d.meta.url = str(raw.meta.url, '').slice(0, 300);
      }

      if (isObj(raw.size)) {
        d.size.chosen = str(raw.size.chosen, '').slice(0, 20);
        d.size.sizeLabels = normStrArray(raw.size.sizeLabels, 32, 12);
        d.size.alterations = str(raw.size.alterations, '').slice(0, 2000);
        d.size.unit = /^(cm|mm|inch|in)$/.test(str(raw.size.unit, '')) ? raw.size.unit : '';
      }

      if (isObj(raw.measurements)) {
        d.measurements.body = normMeasureRows(raw.measurements.body);
        d.measurements.finished = normMeasureRows(raw.measurements.finished);
        var mine = [];
        if (isArr(raw.measurements.mine)) {
          for (var mi = 0; mi < raw.measurements.mine.length && mine.length < 40; mi++) {
            var mr = raw.measurements.mine[mi];
            if (!isObj(mr)) continue;
            var ml = str(mr.label, '').replace(/^\s+|\s+$/g, '').slice(0, 40);
            if (!ml) continue;
            mine.push({ label: ml, value: str(mr.value, '').slice(0, 24) });
          }
        }
        d.measurements.mine = mine;
      }

      if (isArr(raw.fabric)) {
        for (var fi = 0; fi < raw.fabric.length && d.fabric.length < 40; fi++) {
          var f = raw.fabric[fi];
          if (!isObj(f)) continue;
          var fname = str(f.name, '').replace(/^\s+|\s+$/g, '').slice(0, 60);
          var fline = str(f.line, '').slice(0, 200);
          if (!fname && !fline) continue;
          d.fabric.push({
            name: fname || 'Fabric',
            width: str(f.width, '').slice(0, 24),
            amounts: normStrArray(f.amounts, 32, 16),
            rawAmounts: normStrArray(f.rawAmounts, 32, 16),
            note: str(f.note, '').slice(0, 200),
            line: fline
          });
        }
      }

      if (isArr(raw.notions)) {
        for (var ni = 0; ni < raw.notions.length && d.notions.length < 200; ni++) {
          var nn = raw.notions[ni];
          if (!isObj(nn)) continue;
          var ntext = str(nn.text, '').replace(/^\s+|\s+$/g, '').slice(0, 160);
          if (!ntext) continue;
          d.notions.push({
            id: str(nn.id, '') || uid('n'),
            text: ntext,
            qty: (nn.qty === null || nn.qty === undefined || nn.qty === '') ? null : clampInt(nn.qty, 1, 999, null),
            kind: /^(notion|hardware|interfacing)$/.test(str(nn.kind, '')) ? nn.kind : notionKind(ntext),
            have: !!nn.have
          });
        }
      }

      if (isArr(raw.cutting)) {
        for (var ci = 0; ci < raw.cutting.length && d.cutting.length < 300; ci++) {
          var cc = raw.cutting[ci];
          if (!isObj(cc)) continue;
          var cpiece = str(cc.piece, '').replace(/^\s+|\s+$/g, '').slice(0, 60);
          if (!cpiece) continue;
          var cqty = clampInt(cc.qty, 1, 999, 1);
          d.cutting.push({
            id: str(cc.id, '') || uid('c'),
            piece: cpiece,
            qty: cqty,
            cutCount: clampInt(cc.cutCount, 0, cqty, 0),
            material: MATERIAL_SET[str(cc.material, '')] ? cc.material : 'main',
            onFold: !!cc.onFold,
            grain: str(cc.grain, '').slice(0, 40),
            note: str(cc.note, '').slice(0, 120),
            dims: str(cc.dims, '').slice(0, 60)
          });
        }
      }

      if (isArr(raw.steps)) {
        for (var si = 0; si < raw.steps.length && d.steps.length < 400; si++) {
          var ss = raw.steps[si];
          if (!isObj(ss)) continue;
          var stext = str(ss.text, '').replace(/^\s+|\s+$/g, '').slice(0, STEP_TEXT_CAP + 8);
          if (!stext) continue;
          d.steps.push({
            id: str(ss.id, '') || uid('s'),
            n: clampInt(ss.n, 0, 9999, d.steps.length + 1),
            section: str(ss.section, '').slice(0, 60),
            text: stext,
            done: !!ss.done,
            page: (typeof ss.page === 'number' && isFinite(ss.page)) ? clampInt(ss.page, 0, 9999, null) : null,
            imageRef: typeof ss.imageRef === 'string' && ss.imageRef ? ss.imageRef.slice(0, 120) : null
          });
        }
      }
      d.currentStep = clampInt(raw.currentStep, 0, Math.max(0, d.steps.length - 1), 0);

      // Page images: [{ n, blobKey, w, h }], n is the 1-based PDF page number
      // (the same number steps[].page carries). Rows without a key are dropped,
      // duplicates collapse, and the list is sorted so ‹ › walks it in order.
      if (isArr(raw.pages)) {
        var seenPage = {};
        var pages = [];
        for (var pi = 0; pi < raw.pages.length && pages.length < PAGE_CAP; pi++) {
          var pg = raw.pages[pi];
          if (!isObj(pg)) continue;
          // clampInt(…, 0, …) so a 0 or a negative page number falls out here
          // rather than being clamped up into a page that does not exist.
          var pn = clampInt(pg.n, 0, 9999, 0);
          var bk = str(pg.blobKey, '').slice(0, 160);
          if (pn < 1 || !bk || seenPage[pn]) continue;
          seenPage[pn] = 1;
          pages.push({
            n: pn,
            blobKey: bk,
            w: clampInt(pg.w, 0, 20000, 0),
            h: clampInt(pg.h, 0, 20000, 0)
          });
        }
        pages.sort(function (a, b) { return a.n - b.n; });
        d.pages = pages;
      }

      if (isArr(raw.units)) {
        for (var ui = 0; ui < raw.units.length && d.units.length < 24; ui++) {
          var uu = raw.units[ui];
          if (!isObj(uu)) continue;
          var uname = str(uu.name, '').replace(/^\s+|\s+$/g, '').slice(0, 40);
          if (!uname) continue;
          var target = clampInt(uu.target, 0, 99999, 0);
          d.units.push({
            id: str(uu.id, '') || uid('u'),
            name: uname,
            target: target,
            done: clampInt(uu.done, 0, target > 0 ? target : 99999, 0)
          });
        }
      }

      d.seamAllowance = normSeamAllowance(raw.seamAllowance);

      if (isObj(raw.machine)) {
        d.machine.needle = str(raw.machine.needle, '').slice(0, 60);
        d.machine.thread = str(raw.machine.thread, '').slice(0, 60);
        d.machine.stitchLength = str(raw.machine.stitchLength, '').slice(0, 20);
        d.machine.tension = str(raw.machine.tension, '').slice(0, 20);
        d.machine.presserFoot = str(raw.machine.presserFoot, '').slice(0, 40);
        d.machine.notes = str(raw.machine.notes, '').slice(0, 2000);
      }

      d.sourceText = str(raw.sourceText, '').slice(0, SOURCE_CAP);
      d.warnings = normStrArray(raw.warnings, 20, 200);
    } catch (e) {
      // fall through with whatever was repaired
    }
    return d;
  }

  /**
   * Sewing.toCraftData(parse, existing, opts) -> SewingData
   * Merge rules (research B.3.4): done / have / cutCount are preserved by normalised
   * text; size, alterations, machine and meta.url are never overwritten.
   * opts.groups = { steps, cutting, notions, sizes, fabric, seamAllowance, units, meta }
   * - any group set to false keeps the existing data for that group.
   */
  function toCraftData(parseResult, existing, opts) {
    opts = opts || {};
    var groups = opts.groups || {};
    function want(name) { return groups[name] !== false; }

    var prev = normalizeData(existing || null, null);
    var pr = isObj(parseResult) ? parseResult : emptyParse();
    var out = normalizeData(prev, null);   // start from a clean copy of what exists

    // --- meta: fill blanks, never clobber the user's url ---------------------
    if (want('meta') && isObj(pr.meta)) {
      if (str(pr.meta.patternName, '')) out.meta.patternName = str(pr.meta.patternName, '').slice(0, 80);
      if (str(pr.meta.designer, '')) out.meta.designer = str(pr.meta.designer, '').slice(0, 80);
      if (str(pr.meta.version, '')) out.meta.version = str(pr.meta.version, '').slice(0, 20);
      if (!out.meta.view && isArr(pr.meta.views) && pr.meta.views.length === 1) out.meta.view = pr.meta.views[0];
    }
    out.meta.url = prev.meta.url;                 // never overwritten

    // --- sizes / measurements ----------------------------------------------
    if (want('sizes') && pr.sizes && isArr(pr.sizes.labels) && pr.sizes.labels.length) {
      out.size.sizeLabels = normStrArray(pr.sizes.labels, 32, 12);
      out.size.unit = /^(cm|mm|inch|in)$/.test(str(pr.sizes.unit, '')) ? pr.sizes.unit : '';
      out.measurements.body = normMeasureRows(pr.sizes.chart);
      out.measurements.finished = normMeasureRows(pr.sizes.finished);
    }
    out.size.chosen = prev.size.chosen;            // never overwritten
    out.size.alterations = prev.size.alterations;  // never overwritten
    out.measurements.mine = prev.measurements.mine;

    // --- fabric -------------------------------------------------------------
    if (want('fabric') && isArr(pr.fabric) && pr.fabric.length) {
      out.fabric = normalizeData({ fabric: pr.fabric }, null).fabric;
    }

    // --- notions: preserve `have` by normalised text -------------------------
    if (want('notions') && isArr(pr.notions) && pr.notions.length) {
      var hadNotion = {};
      prev.notions.forEach(function (r) { if (r.have) hadNotion[key(r.text)] = 1; });
      var notions = [];
      for (var i = 0; i < pr.notions.length && notions.length < 200; i++) {
        var nr = pr.notions[i];
        if (!isObj(nr)) continue;
        var ntext = str(nr.text, '').replace(/^\s+|\s+$/g, '').slice(0, 160);
        if (!ntext) continue;
        notions.push({
          id: uid('n'),
          text: ntext,
          qty: (nr.qty === null || nr.qty === undefined) ? null : clampInt(nr.qty, 1, 999, null),
          kind: /^(notion|hardware|interfacing)$/.test(str(nr.kind, '')) ? nr.kind : notionKind(ntext),
          have: !!hadNotion[key(ntext)]
        });
      }
      out.notions = notions;
    }

    // --- cutting: preserve cutCount by normalised piece ----------------------
    if (want('cutting') && isArr(pr.cuttingList) && pr.cuttingList.length) {
      var hadCut = {};
      prev.cutting.forEach(function (r) { if (r.cutCount > 0) hadCut[key(r.piece)] = r.cutCount; });
      var cutting = [];
      for (var c = 0; c < pr.cuttingList.length && cutting.length < 300; c++) {
        var cr = pr.cuttingList[c];
        if (!isObj(cr)) continue;
        var piece = str(cr.piece, '').replace(/^\s+|\s+$/g, '').slice(0, 60);
        if (!piece) continue;
        var qty = clampInt(cr.qty, 1, 999, 1);
        cutting.push({
          id: uid('c'),
          piece: piece,
          qty: qty,
          cutCount: clampInt(hadCut[key(piece)], 0, qty, 0),
          material: MATERIAL_SET[str(cr.material, '')] ? cr.material : 'main',
          onFold: !!cr.onFold,
          grain: str(cr.grain, '').slice(0, 40),
          note: str(cr.note, '').slice(0, 120),
          dims: str(cr.dims, '').slice(0, 60)
        });
      }
      out.cutting = cutting;
    }

    // --- steps: preserve done by normalised text ----------------------------
    if (want('steps') && isArr(pr.steps) && pr.steps.length) {
      var hadStep = {};
      prev.steps.forEach(function (r) { if (r.done) hadStep[key(r.text)] = 1; });
      var steps = [];
      for (var s = 0; s < pr.steps.length && steps.length < 400; s++) {
        var sr = pr.steps[s];
        if (!isObj(sr)) continue;
        var text = str(sr.text, '').replace(/^\s+|\s+$/g, '').slice(0, STEP_TEXT_CAP + 8);
        if (!text) continue;
        steps.push({
          id: uid('s'),
          n: clampInt(sr.n, 0, 9999, steps.length + 1),
          section: str(sr.section, '').slice(0, 60),
          text: text,
          done: !!hadStep[key(text)],
          page: (typeof sr.page === 'number' && isFinite(sr.page)) ? clampInt(sr.page, 0, 9999, null) : null,
          imageRef: null
        });
      }
      out.steps = steps;
      out.currentStep = clampInt(prev.currentStep, 0, Math.max(0, steps.length - 1), 0);
    }

    // --- quilt unit counters: preserve done by name --------------------------
    if (want('units') && isArr(pr.units) && pr.units.length) {
      var hadUnit = {};
      prev.units.forEach(function (u) { hadUnit[key(u.name)] = u.done; });
      var units = [];
      for (var u2 = 0; u2 < pr.units.length && units.length < 24; u2++) {
        var ur = pr.units[u2];
        if (!isObj(ur)) continue;
        var uname = str(ur.name, '').replace(/^\s+|\s+$/g, '').slice(0, 40);
        if (!uname) continue;
        var target = clampInt(ur.target, 0, 99999, 0);
        units.push({
          id: uid('u'),
          name: uname,
          target: target,
          done: clampInt(hadUnit[key(uname)], 0, target > 0 ? target : 99999, 0)
        });
      }
      out.units = units;
    }

    // --- seam allowance ------------------------------------------------------
    if (want('seamAllowance') && pr.seamAllowance) {
      out.seamAllowance = normSeamAllowance(pr.seamAllowance);
    }

    // --- machine settings are the sewist's own; never overwritten -------------
    out.machine = prev.machine;

    // --- page images survive a re-import untouched; the UI re-renders them
    // only when the "keep the pages" box is ticked again ----------------------
    out.pages = prev.pages;

    var src = str(pr.sourceText, '');
    if (src) out.sourceText = src.slice(0, SOURCE_CAP);
    out.warnings = normStrArray(pr.warnings, 20, 200);
    return out;
  }

  /** Home-card line: 'Tansey Top · step 7 of 34 · 4 of 12 cut'. */
  function summary(project) {
    try {
      var p = isObj(project) ? project : {};
      var d = normalizeData(p.craftData, p);
      var bits = [];
      if (d.meta.patternName) bits.push(d.meta.patternName);
      if (d.steps.length) {
        var at = Math.min(d.currentStep, d.steps.length - 1) + 1;
        bits.push('step ' + at + ' of ' + d.steps.length);
      }
      if (d.cutting.length) {
        var cut = 0;
        for (var i = 0; i < d.cutting.length; i++) if (d.cutting[i].cutCount >= d.cutting[i].qty) cut++;
        bits.push(cut + ' of ' + d.cutting.length + ' cut');
      }
      if (!bits.length && d.notions.length) {
        var have = 0;
        for (var n = 0; n < d.notions.length; n++) if (d.notions[n].have) have++;
        bits.push(have + ' of ' + d.notions.length + ' notions ready');
      }
      if (!bits.length) return 'Sewing project';
      return bits.join(' · ');
    } catch (e) {
      return 'Sewing project';
    }
  }

  // ---------------------------------------------------------------------
  // Built-in templates (research B.4.4). The quilt emoji is deliberately not
  // the thread spool - that one belongs to the cross-stitch craft.
  // ---------------------------------------------------------------------

  function cut(piece, qty, material, onFold) {
    return { piece: piece, qty: qty, material: material, onFold: !!onFold, cutCount: 0, grain: '', note: '', dims: '' };
  }
  function notion(text, qty) {
    return { text: text, qty: qty === undefined ? null : qty, kind: notionKind(text), have: false };
  }

  var TEMPLATES = [
    {
      id: 'sew-garment', name: 'Garment', emoji: '🧥',
      craft: 'sewing', countMode: 'rows', groupSize: 0,
      parts: [{ name: 'Main', makeCount: 1 }], checklist: [],
      craftData: {
        cutting: [
          cut('Front', 1, 'main', true),
          cut('Back', 1, 'main', true),
          cut('Sleeve', 2, 'main', false),
          cut('Facing / Neckband', 1, 'main', false),
          cut('Interfacing', 1, 'interfacing', false)
        ],
        notions: [
          notion('Matching thread'),
          notion('Interfacing'),
          notion('Zip or buttons'),
          notion('Bias binding')
        ]
      }
    },
    {
      id: 'sew-bag', name: 'Bag', emoji: '👜',
      craft: 'sewing', countMode: 'rows', groupSize: 0,
      parts: [{ name: 'Main', makeCount: 1 }], checklist: [],
      craftData: {
        cutting: [
          cut('Exterior', 2, 'main', false),
          cut('Lining', 2, 'lining', false),
          cut('Pocket', 2, 'lining', false),
          cut('Strap', 2, 'main', false),
          cut('Base', 1, 'main', false),
          cut('Interfacing', 2, 'interfacing', false)
        ],
        notions: [
          notion('Zip'),
          notion('Magnetic snap', 1),
          notion('D-rings', 2),
          notion('Swivel hooks', 2),
          notion('Webbing'),
          notion('Thread'),
          notion('Rivets')
        ]
      }
    },
    {
      id: 'sew-quilt', name: 'Quilt', emoji: '🛏️',
      craft: 'sewing', countMode: 'rows', groupSize: 0,
      parts: [{ name: 'Main', makeCount: 1 }], checklist: [],
      craftData: {
        cutting: [
          cut('Fabric A strips', 1, 'other', false),
          cut('Fabric B strips', 1, 'other', false),
          cut('Background', 1, 'other', false),
          cut('Backing', 1, 'other', false),
          cut('Binding', 1, 'contrast', false),
          cut('Batting', 1, 'batting', false)
        ],
        notions: [
          notion('Piecing thread'),
          notion('Quilting thread'),
          notion('Batting'),
          notion('Basting pins or spray'),
          notion('Walking foot'),
          notion('Rotary blade')
        ],
        units: [],
        seamAllowance: { text: 'Quilting standard — 1/4"', mm: 6, inches: '1/4', included: null, exceptions: [] }
      }
    }
  ];

  function templates() { return deepCopy(TEMPLATES) || []; }

  // =====================================================================
  // Exports
  // =====================================================================

  window.Sewing = {
    parse: parse,
    normalizeText: normalizeText,
    parseSteps: parseSteps,
    parseCutting: parseCutting,
    parseNotions: parseNotions,
    parseSeamAllowance: parseSeamAllowance,
    parseSizes: parseSizes,
    parseFabric: parseFabric,
    parseUnits: parseUnits,
    parseMeta: parseMeta,
    detectKind: detectKind,
    toCraftData: toCraftData,
    normalize: normalizeData,
    summary: summary,
    templates: templates,
    TEMPLATES: TEMPLATES,
    PAGE_CAP: PAGE_CAP,
    // small pieces the UI and the tests both want
    isHeading: isHeading,
    headingKind: headingKind,
    headingText: headingText,
    stepMarker: stepMarker,
    cutRow: cutRow,
    notionQty: notionQty,
    notionKind: notionKind,
    toLines: toLines,
    classify: classify
  };

  // Registration is guarded so this file also loads standalone in a test page.
  if (window.Store && typeof window.Store.registerCraft === 'function') {
    try {
      window.Store.registerCraft({
        id: 'sewing',
        normalize: normalizeData,
        summary: summary,
        templates: templates()
      });
    } catch (eReg) { /* the shell will fall back to "this project needs the sewing module" */ }
  }

})();
