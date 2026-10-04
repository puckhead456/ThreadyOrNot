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
  // Words PdfText splits at a kerning pair in Peppermint's display face
  // ('MAKE AND AT TACH WAISTBAND', 'INSERT AND SECURE EL ASTIC', 'CUT TING
  // L AYOUTS'); xpdf reads the same headings whole (sewing-audit).
  var KERN_WORDS = { attach: 1, attaching: 1, elastic: 1, cutting: 1, layout: 1, layouts: 1,
    pattern: 1, patterns: 1, stitching: 1, straps: 1, getting: 1, setting: 1, button: 1, buttons: 1 };

  function unkern(s) {
    var w = s.split(/\s+/), out = [];
    for (var i = 0; i < w.length; i++) {
      if (i + 1 < w.length && KERN_WORDS[(w[i] + w[i + 1]).toLowerCase()] &&
          !KERN_WORDS[w[i + 1].toLowerCase()]) { out.push(w[i] + w[i + 1]); i++; continue; }
      out.push(w[i]);
    }
    return out.join(' ');
  }

  function prettyHeading(s) {
    s = str(s, '').trim();
    if (!s) return '';
    if (!/[a-z]/.test(s)) s = unkern(s);
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
  // A stacked fraction drawn as separate glyph runs: the numerator sits on its
  // own text row, the fraction slash U+2044 and the denominator on the next.
  // Faux-bold art (FreeSpirit / Anna Maria booklets) prints every glyph twice,
  // so '3 ⁄22"' with '11' on the line above is really '3 1/2"'.
  var DOUBLED_DIGIT = /^(\d)\1$/;
  // Dot leaders, spaced or solid: 'Front . . . . Cut 2' and 'Front........Cut 2'.
  var LEADER_RE = /(?:[.·…–—_\-][ \t]*){3,}/g;
  var UNI_DASH = /[‐-―−]/g;
  var LEADER_MARK = '\u0001';

  var STACK_SLOT_RE = /(^|\s)\/(\d{1,2})(?!\d)/g;
  var IMPROPER_SLOT_RE = /\b(\d{1,2})\/(\d{1,2})(?=\s*(?:"|''|in\b|yards?\b|yds?\b))/g;

  /**
   * Re-unite a stacked fraction with the numerator row printed above it.
   * A line made only of doubled digits ('11', '33 55') is the numerator run of
   * the line below; when the counts agree the numerators are spliced back into
   * their slots ('64 /2" x 64 /2"' -> '64 1/2" x 64 1/2"'). Either way the
   * numerator-only row is dropped: on its own it is a phantom number that the
   * step and cutting parsers would otherwise read as data.
   */
  function repairStackedFractions(s) {
    if (s.indexOf('/') < 0) return s;
    var lines = s.split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/^\s+|\s+$/g, '');
      var toks = t ? t.split(/\s+/) : [];
      var nums = [], allDoubled = toks.length > 0, restText = '';
      for (var k = 0; k < toks.length; k++) {
        var dm = DOUBLED_DIGIT.exec(toks[k]);
        if (!dm) {
          // '11 11 Fabric D - D and D: Cut 4 each' / '11 B B B': the
          // numerator row with a diagram caption glued on after it
          // (FreeSpirit Harmony). The caption survives as its own line.
          if (nums.length && /^[A-Za-z]/.test(toks[k])) { restText = toks.slice(k).join(' '); break; }
          allDoubled = false; break;
        }
        nums.push(dm[1]);
      }
      if (restText && i + 1 < lines.length) {
        var slots0 = lines[i + 1].match(STACK_SLOT_RE);
        if (!slots0 || slots0.length !== nums.length) { out.push(lines[i]); continue; }
      }
      if (allDoubled && i + 1 < lines.length) {
        var slots = lines[i + 1].match(STACK_SLOT_RE);
        if (slots && slots.length) {
          if (slots.length === nums.length) {
            var at = 0;
            lines[i + 1] = lines[i + 1].replace(STACK_SLOT_RE, function (whole, lead, den) {
              return lead + nums[at++] + '/' + den;
            });
          }
          if (restText) out.push(restText);
          continue;
        }
      }
      // Once the extractor drops faux-bold duplicates the numerator row is a
      // plain '1' ('1' / 'PWCG005.CLEAR /3 yard'): single digits are only
      // spliced when the slots match exactly, and never guessed otherwise.
      // ('1 1 Fabric D - D and D: Cut 4 each' — a diagram caption can ride on
      // the numerator row; it is kept as a line of its own.)
      var sdm = /^(\d(?:\s+\d)*)(?:\s+([A-Za-z].*))?$/.exec(t);
      if (sdm && i + 1 < lines.length) {
        var sd = sdm[1].split(/\s+/), cap = sdm[2] || '';
        var slots1 = lines[i + 1].match(STACK_SLOT_RE);
        if (slots1 && slots1.length === sd.length) {
          var at1 = 0;
          lines[i + 1] = lines[i + 1].replace(STACK_SLOT_RE, function (whole, lead, den) {
            return lead + sd[at1++] + '/' + den;
          });
          if (cap) out.push(cap);
          continue;
        }
        // '3 5' / '(4) each 6/4" tall x 7/8" wide': the slash glued to the
        // whole number. An improper fraction is never printed as a
        // measurement, so '6/4"' is '6 ?/4"' waiting for its numerator.
        // ('7/8"' beside it is then '7 5/8"': the numerator row counts every
        // fraction on the line, and at least one has to be impossible.)
        var imp = 0, allFr = 0;
        lines[i + 1].replace(IMPROPER_SLOT_RE, function (whole, w, den) {
          allFr++;
          if (parseInt(w, 10) >= parseInt(den, 10)) imp++;
          return whole;
        });
        if (imp && allFr === sd.length) {
          var at2 = 0;
          lines[i + 1] = lines[i + 1].replace(IMPROPER_SLOT_RE, function (whole, w, den) {
            return w + ' ' + sd[at2++] + '/' + den;
          });
          if (cap) out.push(cap);
          continue;
        }
        // '1' / '1/4 yards (1.14m)': the whole number of a mixed yardage
        // lifted onto its own row.
        if (!cap && sd.length === 1 && /^\d\/\d{1,2}\s*(?:yards?|yds?)\b/i.test(lines[i + 1].replace(/^\s+/, ''))) {
          lines[i + 1] = sd[0] + ' ' + lines[i + 1].replace(/^\s+/, '');
          continue;
        }
      }
      out.push(lines[i]);
    }
    return out.join('\n');
  }

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
    // 'Pellon® Peltex® 70': the marks are not part of the product code.
    s = s.replace(/[®™]/g, '');
    // quotes and prime marks
    s = s.replace(/[“”„‟″]/g, '"');
    s = s.replace(/[‘’‚‛′]/g, "'");
    s = s.replace(/''/g, '"');
    s = s.replace(/``/g, '"');
    // fractions: glued to a digit gains a space (4 1/2), standalone expands in place
    s = s.replace(FRAC_AFTER_DIGIT, function (m, d, f) { return d + ' ' + FRACTIONS[f]; });
    s = s.replace(FRAC_CLASS, function (f) { return FRACTIONS[f] || f; });
    // stacked fractions: the fraction slash becomes '/', and a denominator that
    // was drawn twice ('⁄22' -> '/2') is collapsed before anything counts digits.
    // Only the fraction slash U+2044 comes from that art; an ASCII slash
    // between two units is a dual-unit value ('84cm/33"'), never a
    // denominator, and must keep its digits.
    s = s.replace(/⁄(\d)\1(?!\d)/g, '⁄$1');
    s = s.replace(/⁄/g, '/');
    s = repairStackedFractions(s);
    // dot leaders / long dash runs -> a protected separator
    s = s.replace(LEADER_RE, LEADER_MARK);
    s = s.replace(/…+/g, LEADER_MARK);
    // remaining typographic dashes -> ascii hyphen
    s = s.replace(UNI_DASH, '-');
    // '11/8 yard' is how Peppermint's text layer spells 1⅛ yard: an improper
    // fraction is never printed as a yardage, so the leading digit is the
    // whole number (sewing-audit).
    s = s.replace(/\b(\d)(\d{1,2})\/(2|3|4|8|16)(?=\s*(?:yards?|yds?)\b)/gi, function (m, w, n, d) {
      return parseInt(w + n, 10) > parseInt(d, 10) && parseInt(n, 10) < parseInt(d, 10) ? w + ' ' + n + '/' + d : m;
    });
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

  // --- letter-spaced / double-printed headings -----------------------------
  //
  // Designers set section titles as tracked-out display type ('fa b r I c r e Q
  // U I r e M e n t S') and fake bold by drawing every glyph twice ('FA B R I
  // CFA B R I C'). PdfText repairs spacing inside one text item, but these are
  // drawn as dozens of separate items, so the booklet arrives with its section
  // headings shattered — and without them there are no blocks at all.
  //
  // The repair: squash the line to bare letters, collapse adjacent repeats, then
  // split the result back into words with a small heading dictionary. A line we
  // cannot split stays unrecognised rather than becoming a bogus heading.

  var HEAD_WORDS = ('cutting cut directions direction instructions instruction list guide fabric fabrics ' +
    'requirements requirement construction quilt top assembly binding notions materials needed supplies ' +
    'hardware interfacing size sizes chart measurements finishing finished sewing steps step template ' +
    'templates pieces piece pattern preparation block blocks additional blenders layout note notes tips ' +
    'and the for this project you will need what from yardage seam allowance allowances method pockets ' +
    'piecing sew make making up let us get started before begin about tools').split(' ');
  var HEAD_WORD_SET = {};
  (function () {
    for (var i = 0; i < HEAD_WORDS.length; i++) HEAD_WORD_SET[HEAD_WORDS[i]] = HEAD_WORDS[i].length;
  })();

  function squashKey(s) {
    return collapseDoubles(str(s, '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
  }

  /** 'fabricfabricrequirementsrequirements' -> 'fabricrequirements'. */
  function collapseDoubles(s) {
    var i = 0, guard = 0;
    while (i < s.length && guard++ < 400) {
      var max = Math.min(24, Math.floor((s.length - i) / 2));
      var hit = 0;
      for (var L = max; L >= 2; L--) {
        if (s.substr(i, L) === s.substr(i + L, L)) { s = s.slice(0, i) + s.slice(i + L); hit = L; break; }
      }
      i += hit || 1;
    }
    return s;
  }

  /** True when a line is tracked-out display type rather than prose. */
  function letterSpaced(t) {
    var s0 = str(t, '');
    // Cheap rejection first: tracked-out type breaks within the first few
    // characters, and isHeading asks this question of every line in the booklet.
    if (s0.length < 7) return false;
    var firstSpace = s0.indexOf(' ');
    if (firstSpace < 0 || firstSpace > 3) return false;
    var toks = s0.replace(/^\s+|\s+$/g, '').split(/\s+/);
    if (toks.length < 4) return false;
    var singles = 0;
    for (var i = 0; i < toks.length; i++) if (toks[i].length === 1) singles++;
    return singles / toks.length >= 0.5;
  }

  /** 'cuttingdirections' -> 'Cutting Directions'; '' when it will not split. */
  function splitSquashed(sq) {
    var words = [], at = 0, guard = 0;
    while (at < sq.length && guard++ < 40) {
      var best = '';
      for (var w = 0; w < HEAD_WORDS.length; w++) {
        var word = HEAD_WORDS[w];
        if (word.length > best.length && sq.substr(at, word.length) === word) best = word;
      }
      if (!best) return '';
      words.push(best.charAt(0).toUpperCase() + best.slice(1));
      at += best.length;
    }
    return at === sq.length ? words.join(' ') : '';
  }

  /** The repaired title of a letter-spaced / double-printed heading, or ''. */
  function despacedHeading(t) {
    if (!letterSpaced(t)) return '';
    var sq = squashKey(t);
    if (sq.length < 4 || sq.length > 48) return '';
    return splitSquashed(sq);
  }

  var HEAD_MAX = 48;
  var CUT_LABEL_RE = /^[A-Za-z][A-Za-z0-9 *'\/-]{1,30},\s*(?:fussy\s+)?cut\s*:?\s*$/i;
  var LOWER_HEAD_RE = /^(?:fabrics?(?:\s+(?:requirements?|suggestions?))?|yardage|requirements?|notions?|supplies|materials(?:\s+needed)?|hardware|haberdashery|cutting(?:\s+(?:instructions?|list|directions?))?|cut\s+list|instructions?|sewing\s+instructions?|construction|assembly|(?:quilt\s+)?top\s+assembly|quilt\s+assembly|piecing|finishing|size\s+chart|sizing|measurements|body\s+measurements)$/i;
  // NB: 'binding' is deliberately absent — it is a word a notions list ends on
  // ('13mm bias' / 'binding'), and as a section title it is printed in caps.
  var ALLCAPS_RE = /^[A-Z0-9][A-Z0-9 '&\/()."%-]*$/;
  var TITLE_RE = /^([A-Z][A-Za-z'-]*)(\s+([A-Z][A-Za-z0-9'-]*|&|of|the|and|in|a|an|for|to|with|your|my|on|at))*$/;

  /** Strip a leading '3. ' style number and a trailing colon / bang. */
  function headingText(t) {
    return str(t, '').replace(/^\s+|\s+$/g, '')
      .replace(/^\d{1,2}\s*[.):]\s*/, '')
      .replace(/\s*[:!]\s*$/, '')
      .replace(/^\s+|\s+$/g, '');
  }

  function isHeading(t) {
    var s = str(t, '').replace(/^\s+|\s+$/g, '');
    if (!s) return false;
    // A shattered display heading, repaired above, is still a heading — and it
    // is checked before the length guard, because a title drawn twice at one
    // glyph per item ('FA B R I CFA B R I C …') is three times its own length.
    if (s.length <= HEAD_MAX * 3 && despacedHeading(s)) return true;
    if (s.length > HEAD_MAX) return false;
    if (/[.?,;]$/.test(s)) return false;
    // A title may end in an exclamation ("LET'S GET SEWING!"); a sentence does
    // not get away with it, so keep the allowance short.
    if (/!$/.test(s) && s.length > 30) return false;
    // 'Fabric D, cut:' / 'Fabric B, fussy cut:' — a heading with a comma in it,
    // which the Title-Case test would throw away.
    if (CUT_LABEL_RE.test(s)) return true;
    var core = headingText(s);
    // Magazines set their section titles in lower case ('fabric requirements').
    // Only the exact block names count here — the wildcard forms ('sew the …')
    // would let prose in.
    if (s.length <= HEAD_MAX && LOWER_HEAD_RE.test(core)) return true;
    if (!core || !/[A-Za-z]/.test(core)) return false;
    if (core.split(/\s+/).length > 7) return false;
    if (!/[a-z]/.test(core) && ALLCAPS_RE.test(core) && /[A-Z]{2}/.test(core)) return true;
    return TITLE_RE.test(core);
  }

  var HEAD_PATTERNS = [
    // 'Fabric D, cut' / 'Fabric B, fussy cut' heads a per-fabric cutting block
    // in every quilt booklet read so far; 'Preparation Cutting' heads the
    // template prep, which must not leak into the construction steps.
    ['cut', /^(?:cutting(?:\s+(?:instructions?|list|guide|directions?|out|notes?))?|cut(?:ting)?\s+your\s+fabric|cut\s+list|cutting\s+and\s+marking|preparation\s+cutting|pattern\s+pieces|pieces\s+to\s+cut|(?:from\s+)?(?:fabric|the)?\s*[a-z0-9][a-z0-9 *]{0,24}\s*,\s*(?:fussy\s+)?cut|from\s+(?:fabric\s+)?[a-z0-9][a-z0-9 ]{0,24})$/i],
    // 'MATERIALS REQUIRED' and 'Optional Tools' head the notions list as often
    // as 'NOTIONS' does; without them the list sits inside whatever block came
    // before it and never reaches the shopping list.
    ['notions', /^(?:notions?(?:\s+(?:list|needed|required|and\s+supplies))?|supplies|you\s*'?\s*(?:ll|will)\s+need|what\s+you\s*'?\s*(?:ll|will)\s+need|haberdashery|hardware(?:\s+list)?|materials?(?:\s+(?:list|needed|required|and\s+notions|and\s+supplies))?|(?:optional\s+)?tools?(?:\s+and\s+supplies)?|interfacing(?:\s+list)?)$/i],
    // 'REQUIREMENTS TRIPLE T TOTE' — free patterns head the yardage block with
    // the word and then the pattern's own name, so match on the opening word.
    ['fabric', /^(?:fabrics?(?:\s+(?:requirements?|suggestions?|recommendations?|needed|and\s+notions))?|yardage(?:\s+requirements?)?|requirements?\b.{0,30}|fabric\s+quantities)$/i],
    ['size', /^(?:size\s+chart|sizing|sizes?|body\s+measurements?|finished\s+(?:garment\s+)?measurements?|measurements?|finished\s+sizes?|size\s+guide)$/i],
    // 'Top Assembly', 'Quilt Assembly', 'Binding' and 'Block Construction' are
    // the section titles the quilt booklets use; "Let's get cooking!" is the
    // same idea in a magazine's voice.
    ['steps', /^(?:construction(?:\s+.*)?|block\s+construction|instructions?|sewing\s+instructions?|let\s*'?s\s+(?:sew|get\s+(?:sewing|cooking|making|started|stitching))|assembly|block\s+assembly|(?:quilt\s+)?top\s+assembly|quilt\s+assembly|binding|piecing|finishing(?:\s+.*)?|hem(?:ming)?|view\s+[a-z](?:\b.*)?|making\s+up|method|steps?|sew(?:ing)?\s+the\s+.*|attach(?:ing)?\s+.*|the\s+[a-z]+)$/i],
    // Reference matter. It reads like instructions (numbered lists, titled
    // paragraphs) but is never a construction step, a notion or a cut piece.
    // NB: 'Key' and 'Legend' are deliberately NOT here — they are printed
    // *inside* the sewing instructions and would cut the steps block in half.
    ['skip', /^(?:glossary|terms|terms\s+and\s+conditions|t\s*&\s*cs?|pattern\s+symbols?|pattern\s+markings?|before\s+(?:you\s+)?start(?:ing)?(?:\s+.*)?|getting\s+started|creating\s+a\s+perfect\s+fit|how\s+to\s+(?:measure|choose|use|read|print)(?:\s+.*)?|my\s+measurements|lengthen(?:ing)?\s*\/?\s*shorten(?:ing)?|choosing\s+your\s+size|about\s+(?:this\s+)?pattern|sewing\s+level|suggested\s+fabrics?|printing(?:\s+.*)?|copyright(?:\s+.*)?|abbreviations?|difficulty)$/i]
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
        // A tracked-out / double-printed display heading is repaired to real
        // words first, so every rule below sees 'Cutting Directions'.
        var fixed = despacedHeading(core);
        if (fixed) core = fixed;
        var k = headingKind(core);
        // 'SIZE' on its own inside a fabric table labels the columns — Peppermint
        // prints it above 'XS-L 1X-3X 4X-5X 6X-9X' — and must not be read as the
        // start of a size chart, or the yardage below it is lost.
        if (k === 'size' && cur === 'fabric' && /^sizes?$/i.test(core)) k = null;
        if (k) { cur = k; count = 0; if (k === 'steps') sawSteps = true; }
        // Inside a cutting or fabric block an unrecognised "heading" is a table
        // row: 'Fabric A OMH-33447 F8' and 'Main Panel' are Title Case with no
        // full stop. Treating them as headings closed the block after its first
        // row and lost the whole quilt table.
        else if (cur === 'cut' || cur === 'fabric') {
          var asData = (cur === 'cut')
            ? !!cutRow(t, null)
            : (!!widthsIn(t).length || !!plainFabricRow(t));
          if (asData) { kinds[i] = cur; heads[i] = head; continue; }
          // A group label inside the table ('BINDING FABRIC', 'BACKING FABRIC')
          // keeps the block open; a real section heading ends it. What tells them
          // apart is whether more table rows follow.
          if (!blockDataAhead(lines, i + 1, cur)) cur = 'none';
        }
        // 'Scissors' / 'Tape measure' printed one per line under WHAT YOU'LL
        // NEED look like headings, and each one used to end the list (apron).
        else if (cur === 'notions' && !/:\s*$/.test(t) && core.split(/\s+/).length <= 5 &&
                 (NOTION_VOCAB.test(core) || TOOL_ITEM_RE.test(core))) {
          kinds[i] = 'notions'; heads[i] = head; continue;
        }
        // An unrecognised heading ('Sleeve Length:', 'To Lengthen a Bodice:')
        // does not break out of a steps or skip block — it just names a section.
        else if (cur !== 'none' && cur !== 'steps' && cur !== 'skip') { cur = 'none'; }
        head = core;
        kinds[i] = 'head';
        heads[i] = core;
        owners[i] = cur;
        continue;
      }
      // 'TRIMS: 1x 25cm invisible zip, fusing, a button' — a whole notions list
      // on one labelled line. It has to be read wherever it is printed: the
      // booklets that use this form put it under 'SUGGESTED FABRICS:', inside a
      // block this parser otherwise skips. Only the labelled line itself is
      // taken, so the prose around it is still skipped.
      if (cur !== 'notions' && NOTION_LABEL_RE.test(t)) {
        kinds[i] = 'notions';
        heads[i] = head;
        continue;
      }
      // A 'skip' block (glossary, pattern symbols, how-to-measure) ends only at
      // the next recognised heading: its numbered lists must never leak out.
      // '- Take sixty seven (67) … rectangles from fabric L' / 'Sew all right
      // sides together…' after a cutting table: construction has begun even
      // though its heading never reached the text (AGF Catwalk).
      if (cur === 'cut' && (/^[-•*]\s+(?:take|join|pair|arrange|bring)\b/i.test(t) || /^sew all\b/i.test(t))) {
        cur = 'steps'; count = 0; sawSteps = true;
      }
      // 'NOTIONS Narrow elastic width – 6mm…': Peppermint sets the label in a
      // left column, so it arrives glued to the first item (bathers p3).
      if (cur !== 'notions' && /^(?:NOTIONS|HABERDASHERY)\s+[A-Za-z]/.test(t)) { cur = 'notions'; count = 0; }
      // A bulleted cut row ('- One (1) 2 1/4" x 2 1/2" rectangle from fabric
      // A.') inside the yardage block means the cutting table has begun, even
      // when its heading never reached the text (sewing-audit, AGF Catwalk).
      if (cur === 'fabric' && /^[-•*]\s|\bfrom\s+(?:the\s+)?fabric\s+[a-z]{1,2}\b/i.test(t) &&
          !widthsIn(t).length && !plainFabricRow(t) && cutRow(t, null)) {
        cur = 'cut'; count = 0;
      }
      // '- 2" (5cm) Elastic (Use provided elastic chart for' under a combined
      // MATERIALS REQUIRED / FABRIC REQUIREMENTS page is the notions list
      // starting (Peppermint Samford), not another yardage row.
      else if (cur === 'fabric' && BULLET_RE.test(t) && !widthsIn(t).length && !plainFabricRow(t) &&
               NOTION_VOCAB.test(t)) {
        cur = 'notions'; count = 0;
      }
      if (cur !== 'none' && cur !== 'steps' && cur !== 'skip') {
        count++;
        // A quilt's cutting table runs to sixty-five rows over two pages, so the
        // 60-line guard would cut it in half; other blocks stay short.
        if (count > (cur === 'cut' ? 260 : 60)) cur = 'none';
        else if (endsBlock(t, cur)) cur = 'none';
      }
      kinds[i] = cur;
      heads[i] = head;
    }
    return { kinds: kinds, heads: heads, owners: owners, hasSteps: sawSteps };
  }

  /** Do the next few lines still read as rows of this kind of block? */
  function blockDataAhead(lines, from, kind) {
    var seen = 0;
    for (var i = from; i < lines.length && seen < 4; i++) {
      if (lines[i].pageMark) continue;
      var t = lines[i].text;
      if (!t) continue;
      seen++;
      if (kind === 'cut' && cutRow(t, null)) return true;
      if (kind === 'fabric' && (widthsIn(t).length || plainFabricRow(t))) return true;
    }
    return false;
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
  // Case-SENSITIVE on purpose: '14. In the order listed…' is a step, '1. in
  // from the edge' is a measurement fragment. Matching /in/i threw away every
  // step that happened to start with the word "In".
  var UNIT_START_RE = /^(?:cm|mm|m|in|inch(?:es)?|yd|yards?|yds)\b|^"/;
  var REST_OK_RE = /^[A-Za-z("']/;
  // Column bleed glues a floating dimension label to the front of a step:
  // '4 1/2" 5. Stitch a Unit 2a…'. Only accepted when the number continues the
  // running sequence, which is what keeps figure references out.
  var LEAD_DEBRIS_RE = /^[\d\s\/".'x×+-]{1,14}?\s(\d{1,3})\s*[.)]\s+([A-Za-z].*)$/;

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
      // 'Step 1 through buttonhole openings' — no punctuation after the number
      // and a lowercase word: a cross-reference that wrapped onto the start of
      // a line. parseSteps decides with the line above (sewing-audit).
      var bare = !/^step\s*[#]?\s*\d{1,3}\s*[.:)\-]/i.test(s) && /^[a-z]/.test(rest2);
      return { n: parseInt(m[1], 10), rest: rest2, marker: 'Step', bare: bare };
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

  /** A step marker hidden behind column-bleed debris, or null. */
  function debrisMarker(text, lastN) {
    var s = str(text, '').replace(/^\s+|\s+$/g, '');
    if (!s || s.length > 900) return null;
    var m = LEAD_DEBRIS_RE.exec(s);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    if (n !== lastN + 1) return null;
    return { n: n, rest: m[2].replace(/^\s+/, ''), marker: '1.' };
  }

  var SEW_VERB_RE = /\b(?:sew|sewn|sewing|pin|press|stitch|fold|turn|cut|trim|attach|insert|gather|baste|hem|clip|topstitch|edgestitch|understitch|overlock|serge|mark|measure|place|align|match|repeat|make|prep|prepare|apply|fuse|iron|tack|thread|finish|join|divide|slide|pull|tie|draw|arrange|layer|quilt)\b/i;

  /**
   * A numbered "step" that is really only a section label: '4. Waistband:',
   * '7. Skirt:', 'SHELL:'. Two booklets out of two hit this (05 #6), and the
   * step card renders a single word above a 211 px button. No sewing verb, short,
   * and punctuated or shouted like a label -> it names the section instead.
   */
  function labelOnly(rest) {
    var s = str(rest, '').replace(/^\s+|\s+$/g, '');
    if (!s || s.length > 40) return false;
    if (SEW_VERB_RE.test(s)) return false;
    // The colon is the tell. A numbered ALL-CAPS title with no colon ('2)
    // INSTALL HARDWARE') heads the paragraphs of a real step in the booklets
    // that number their sections, so it must stay a step.
    return /:\s*$/.test(s);
  }

  // 'Pattern variations', 'Make it your own', care and social-media pages read
  // exactly like construction (titled paragraphs) and are not construction
  // (05 #2): they are parsed, flagged and kept out of the step count.
  var VARIATION_RE = /\b(?:variations?|alternatives?|make\s+it\s+your\s+own|customi[sz]|inspiration|hack|care|washing|laundry|share|hashtag|about\s+(?:the|us)|copyright|thank\s+you)\b/i;
  var NOTE_LABEL_ONLY_RE = /^(?:notes?|tips?|please\s+note|important|hints?)\s*:?\s*$/i;

  /** Is the next thing in the booklet another marked or titled step? */
  function nextIsStructured(lines, from, kinds) {
    for (var i = from; i < lines.length && i < from + 6; i++) {
      if (lines[i].pageMark) continue;
      var t = lines[i].text;
      if (!t) continue;
      if (kinds && kinds[i] === 'head') return true;
      return !!(stepMarker(t) || titleStep(t));
    }
    return false;
  }

  /**
   * Could this heading-shaped line be a figure caption rather than a section?
   * Short (three words at most), or sitting in the middle of a sentence that
   * the line above did not finish.
   */
  function captionLike(t, prev) {
    var s = str(t, '').replace(/^\s+|\s+$/g, '');
    if (!s || s.length > 40) return false;
    // 'Pattern Variations:' is a section with an intro paragraph, not a caption.
    if (VARIATION_RE.test(s)) return false;
    // 'Adjustable Straps Option Continued:' / 'Centre Front Stitch Line' sit
    // in the middle of a STEP n and head a paragraph of it (Peppermint bathers).
    if (s.split(/\s+/).length <= 5) return true;
    return !!prev && !/[.!?:]["')]?$/.test(prev);
  }

  /**
   * Does unmarked prose of the steps block come next (after at most two more
   * caption lines)? That is what separates a caption inside a step from a
   * section heading, which is followed by the next marked or titled step.
   */
  function proseFollows(lines, from, kinds) {
    var heads = 0;
    for (var i = from; i < lines.length && i < from + 8; i++) {
      // A caption at the foot of a page captions that page; what the next
      // page opens with is not "the rest of the step" by that route.
      if (lines[i].pageMark) return false;
      var t = lines[i].text;
      if (!t) continue;
      if (kinds[i] === 'head') {
        if (stepMarker(t) || ++heads > 2) return false;
        continue;
      }
      // 'none' too: booklets that number their sections ('1) PREPPING') have
      // no recognised steps heading, and a step is known to be running here.
      if (kinds[i] !== 'steps' && kinds[i] !== 'none') return false;
      // Prose, not the next diagram label ('B2a' under 'Quilt Layout').
      if (t.length < 15 || !/[a-z]{2,}\s+[a-z]{2,}/i.test(t)) return false;
      // 'Step A: Thread the strap…' is a sub-step of the running step.
      return !stepMarker(t) && (!titleStep(t) || /^step\s+[a-z]\s*:/i.test(t)) && !BULLET_RE.test(t);
    }
    return false;
  }

  var STEP_TEXT_CAP = 800;
  var STEP_PARTS_MAX = 3;
  var DIAGRAM_HEAD_RE = /^(?:diagram|fig(?:ure)?\.?)\s*[a-z]?\s*\d{0,3}\s*[a-z]?\s*:?$/i;
  var LETTERS_HEAD_RE = /^[A-Z]{1,2}\d?(?:\s+[A-Z]{1,2}\d?){0,7}$/;
  // A line that is only contact details or a copyright notice.
  // 'E S T . 2 0 1 1' — a tracked-out logo line of single characters.
  var BOILERPLATE_RE = /^(?:www\.|https?:\/\/|\S+@\S+\.\w+|©|copyright\b|all rights reserved)|\|\s*e:\s*\S+@|^(?:\S{1,2} ){4,}\S{1,2}$/i;
  // The publisher's disclaimer, matched with the spaces squeezed out because
  // FreeSpirit's kerning splits it ('All possible c a re has b e e n taken').
  var DISCLAIMER_RE = /^(?:allpossiblecare|whileallpossiblecare|pleasereadtheinstructions|readtheinstructionscarefully|note:whileallpossiblecare)/i;

  /** Where to break an over-long step: the last sentence end inside the cap. */
  function sentenceBreak(s, cap) {
    var re = /[.!?]["')]?\s/g, m, best = -1;
    while ((m = re.exec(s)) && m.index < cap) best = m.index + m[0].length - 1;
    if (best >= cap * 0.4) return best;
    var sp = s.lastIndexOf(' ', cap);
    return sp > 0 ? sp : cap;
  }

  // A variations / hack page OUTSIDE the sewing instructions (Peppermint
  // Samford p4 'PATTERN HACK (OPTIONAL!)', printed under 'Choosing your size').
  // The steps loop never sees it, because nothing outside a real steps block
  // is a step, so the page was simply lost. It is kept as an optional extra
  // instead: shown in the collapsed Optional group, never counted (05 #3,
  // Wave F). Care, washing and social pages are not taken from out here.
  var OPTIONAL_HEAD_RE = /\b(?:pattern\s+hacks?|hacks?|variations?|make\s+it\s+your\s+own|customi[sz](?:e|ation|ations)?)\b/i;
  var OPTIONAL_RUN_CAP = STEP_TEXT_CAP * STEP_PARTS_MAX;

  /** 'PATTERN HACK (OPTIONAL!)' -> 'Pattern Hack'; '' when the line is not such a heading. */
  function optionalHead(t) {
    var s = str(t, '').replace(/^\s+|\s+$/g, '');
    if (!s || s.length > 48 || !OPTIONAL_HEAD_RE.test(s)) return '';
    var bare = s.replace(/\(\s*optional\s*!?\s*\)/i, '').replace(/[\s:!.]+$/, '');
    // Shaped like a heading: capitals, or Title Case with no sentence in it.
    // 'This pattern features two length variations: pants and' is prose.
    var caps = !/[a-z]/.test(s) && /[A-Z]{3}/.test(s);
    if (!caps && !(TITLE_RE.test(bare) && bare.split(/\s+/).length <= 6)) return '';
    return prettyHeading(bare) || 'Optional';
  }

  /**
   * The optional pages outside the steps block, as optional StepRows. A run
   * starts at an optional heading and ends at the next heading, page break or
   * block, and is cut into cards the way a long step is.
   */
  function optionalPages(lines, kinds, owners) {
    var out = [], run = null;
    function close() {
      if (run && run.text.length >= 40) {
        var text = run.text.slice(0, OPTIONAL_RUN_CAP), part = 1;
        while (text && part <= STEP_PARTS_MAX && out.length < 200) {
          var piece = text;
          if (text.length > STEP_TEXT_CAP) {
            var at = sentenceBreak(text, STEP_TEXT_CAP);
            piece = text.slice(0, at).replace(/\s+$/, '');
            text = text.slice(at).replace(/^\s+/, '');
          } else {
            text = '';
          }
          out.push({ n: 0, section: run.section, text: (part > 1 ? '(continued) ' : '') + piece,
            page: run.page, marker: 'none', optional: true });
          part++;
        }
      }
      run = null;
    }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], t = ln.text, k = kinds[i];
      if (ln.pageMark) { close(); continue; }
      if (!t) continue;
      // The steps block has its own variations handling; tables are not prose.
      if (k === 'steps' || (owners && owners[i] === 'steps') ||
          k === 'cut' || k === 'fabric' || k === 'notions' || k === 'size') { close(); continue; }
      var oh = optionalHead(t);
      if (oh) { close(); run = { section: oh, text: '', page: typeof ln.page === 'number' ? ln.page : null }; continue; }
      if (k === 'head') { close(); continue; }
      if (run) {
        run.text = run.text ? run.text + ' ' + t : t;
        if (run.text.length > OPTIONAL_RUN_CAP) close();
      }
    }
    close();
    return out;
  }

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
    var variations = [];
    var warns = [];
    var lastN = 0, section = '', cur = null;
    var candidates = 0, jumped = 0, sectionSeq = 1, capped = false, truncated = 0, splitSteps = 0;
    var firstIndex = -1;
    var justCrossedPage = false, lastStep = null, pending = null;
    var optional = false, noteRun = false, prevNonEmpty = '';
    var sectionsSeen = {};
    // A heading printed on three or more pages is a running head.
    var runningHeads = {}, headPages = {};
    for (var rh = 0; rh < lines.length; rh++) {
      if (kinds[rh] !== 'head' || typeof lines[rh].page !== 'number') continue;
      var rk = key(headingText(heads[rh] || lines[rh].text));
      if (!rk) continue;
      headPages[rk] = headPages[rk] || {};
      headPages[rk][lines[rh].page] = 1;
      if (Object.keys(headPages[rk]).length >= 3) runningHeads[rk] = 1;
    }

    /**
     * Add a step, or park it in `variations` when its section is a
     * make-it-your-own / care page. Returns the row to carry continuations on,
     * or null when the cap is hit.
     */
    function pushStep(row, index) {
      var list = optional ? variations : steps;
      if (list.length >= 200) { capped = true; return null; }
      row.optional = optional;
      list.push(row);
      if (!optional && firstIndex < 0) firstIndex = index;
      return row;
    }

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
      prevNonEmpty = '';
      for (var pb = i - 1; pb >= 0 && pb > i - 6; pb--) {
        if (lines[pb].pageMark) break;
        if (lines[pb].text) { prevNonEmpty = lines[pb].text; break; }
      }
      var k = kinds[i];
      if (k === 'head') {
        // A numbered line that also reads as a heading. '3.Side Seams' inside
        // the sewing instructions is a step, and so is '1) PREPPING' in the
        // booklets that number their sections instead of their operations — but
        // a bare label with no sewing verb only names the section (05 #6).
        var owner = owners ? owners[i] : null;
        var ownedElsewhere = owner && owner !== 'steps' && owner !== 'none';
        var hm = ownedElsewhere ? null : stepMarker(t);
        // A bare label is only demoted to a section when the steps underneath it
        // are themselves structured ('4. Waistband:' over 'SHELL: …' / 'LINING:
        // …'). If plain prose follows, the label is the only thing holding that
        // prose, and dropping it would drop the instruction with it (05 #6).
        var demote = hm && labelOnly(hm.rest) && nextIsStructured(lines, i + 1, kinds);
        if (hm && hm.n <= lastN + 12 && !demote) {
          cur = pushStep({
            n: hm.n, section: section, text: hm.rest,
            page: typeof ln.page === 'number' ? ln.page : null, marker: hm.marker
          }, i);
          if (cur) lastN = hm.n;
          justCrossedPage = false; lastStep = null; pending = null; noteRun = false;
          continue;
        }
        // '4. Waistband:' demoted to a section still owns the number: the
        // 'SHELL: …' / 'LINING: …' paragraphs under it are step 4, not a
        // second and third step 3 (Pattern Runway sundress, sewing-audit).
        if (demote && hm.n <= lastN + 12) lastN = hm.n;
        // A figure caption set like a heading in the middle of a running step
        // ('Lining' under the waistband drawing, sundress p7): when plain prose
        // carries on underneath it, that prose is the rest of the step. Before
        // this the prose was dropped with nowhere to go.
        // Not a section at all, and not the end of the running step: a
        // running head printed on every page ('Harmony Quilt'), a diagram label
        // ('DIAGRAM 1', 'Fig. 3', 'K K K K', 'B BB BB'), or a stray repeat of
        // a section already left behind ('QUILT ASSEMBLY' printed again at the
        // foot of AGF's binding page). (sewing-audit)
        var hText = headingText(heads[i] || t);
        var hKey = key(hText);
        if (!hm && runningHeads[hKey]) continue;
        var labelHead = !hm && (DIAGRAM_HEAD_RE.test(hText) || LETTERS_HEAD_RE.test(hText) ||
          (sectionsSeen[hKey] && hKey !== key(section)));
        var running = cur || pending || (justCrossedPage ? lastStep : null);
        if (!hm && running && !headingKind(heads[i] || '') &&
            captionLike(t, prevNonEmpty) && proseFollows(lines, i + 1, kinds)) {
          cur = running; lastStep = null; justCrossedPage = false; pending = null;
          continue;
        }
        // 'Key:' / 'Note:' name a legend, not a section of the garment.
        if (!labelHead && !TITLE_STEP_BAD.test(headingText(heads[i] || ''))) {
          // 'Materials Needed:' over '1) PREPPING' is the block just left
          // behind, not the section the steps sit in (Swoon Mabel); nor is a
          // group label inside the cutting table ('Bikini Top', 'BACKING
          // FABRIC').
          var hk = headingKind(heads[i] || '');
          var hOwner = owners ? owners[i] : null;
          section = ((hk && hk !== 'steps') || (hOwner && hOwner !== 'steps' && hOwner !== 'none'))
            ? '' : prettyHeading(heads[i]);
          if (section) sectionsSeen[key(section)] = 1;
          optional = VARIATION_RE.test(section);
        }
        // 'Notes:' reads as a heading, and the bulleted asides under it are not
        // the first three steps of the quilt.
        noteRun = NOTE_LABEL_ONLY_RE.test(headingText(heads[i] || ''));
        cur = null; lastStep = null; justCrossedPage = false; pending = null;
        continue;
      }
      var inStepsBlock = (k === 'steps');
      var inOtherBlock = (k === 'cut' || k === 'notions' || k === 'fabric' || k === 'size' || k === 'skip');
      if (stepsOnly && !inStepsBlock) { cur = null; lastStep = null; justCrossedPage = false; pending = null; continue; }
      // 'Notes:' / 'Tips:' opens a run of bulleted asides inside the sewing
      // instructions ("Use a 1/4in seam allowance throughout"). They are
      // reference matter, not the first three steps of the quilt.
      if (inStepsBlock && NOTE_LABEL_ONLY_RE.test(t)) {
        noteRun = true; cur = null; lastStep = null; pending = null;
        continue;
      }
      var mk = inOtherBlock ? null : stepMarker(t);
      // '…feed the drawstring made in' / 'Step 1 through buttonhole openings.'
      // (Peppermint Samford, p15): the running sentence wrapped onto a line
      // that begins with a step reference. It is text, not step 1 of a new
      // section — and taking it as one also hid the real step 15 after it.
      if (mk && mk.bare && (cur || pending) && prevNonEmpty && !/[.!?:]["')]?$/.test(prevNonEmpty)) mk = null;
      if (!mk && !inOtherBlock) mk = debrisMarker(t, lastN);
      if (!mk && inStepsBlock) {
        var ts = titleStep(t);
        if (ts) {
          cur = pushStep({
            n: lastN || (steps.length + 1),
            section: section,
            text: ts.title + ': ' + ts.rest,
            page: typeof ln.page === 'number' ? ln.page : null,
            marker: 'title'
          }, i);
          justCrossedPage = false; lastStep = null; pending = null;
          continue;
        }
        // A bulleted construction list: Art Gallery Fabrics and FreeSpirit
        // number nothing, they print one bullet per operation. The bullet is the
        // marker, so each operation becomes its own step in document order.
        // A hyphen that carries on the sentence above it ('…inside the pouch' /
        // '- pocket, aligned with your buttonhole.') is a wrapped word, not a
        // bullet: it starts lowercase AND the line above did not finish its
        // sentence. Art Gallery Fabrics genuinely sets its bullets lowercase,
        // so the previous line is what decides.
        var bulletBody = t.replace(BULLET_RE, '').replace(/^\s+/, '');
        // A one-line bullet above ('- set aside', no full stop) finished its
        // own thought, so the bullet under it is a new one too (AGF Joyous).
        var prevBullet = BULLET_RE.test(prevNonEmpty) && prevNonEmpty.length <= 30;
        var bulletOk = /^[A-Z0-9(]/.test(bulletBody) || !prevNonEmpty || prevBullet ||
          /[.!?:]["')]?$/.test(prevNonEmpty);
        // Short bullets are real operations too ('Set aside', 'Join rows 1-8.'),
        // once the line above is known to have ended (sewing-audit).
        var bulletLong = bulletBody.length >= 20 ||
          (bulletBody.length >= 8 && /^[A-Za-z]/.test(bulletBody) &&
           (!prevNonEmpty || prevBullet || /[.!?:]["')]?$/.test(prevNonEmpty)));
        if (!noteRun && BULLET_RE.test(t) && bulletLong && bulletOk) {
          lastN = lastN + 1;
          cur = pushStep({
            n: lastN,
            section: section,
            text: bulletBody,
            page: typeof ln.page === 'number' ? ln.page : null,
            marker: 'bullet'
          }, i);
          justCrossedPage = false; lastStep = null; pending = null;
          continue;
        }
      }
      if (mk) {
        candidates++;
        if (mk.n > lastN + 12) { jumped++; cur = null; continue; }
        if (mk.n <= lastN && steps.length) {
          var prevSection = steps[steps.length - 1].section;
          if (section === prevSection) { sectionSeq++; section = 'Section ' + sectionSeq; }
        }
        cur = pushStep({
          n: mk.n,
          section: section,
          text: mk.rest,
          page: typeof ln.page === 'number' ? ln.page : null,
          marker: mk.marker
        }, i);
        if (cur) lastN = mk.n;
        justCrossedPage = false; lastStep = null; pending = null; noteRun = false;
        continue;
      }
      // 'sewing instructions - bikini briefs': Peppermint's section running
      // head names the garment the steps below belong to (bathers p19-21).
      var shm = /^sewing instructions\s*-\s*([a-z][a-z ]{2,30})$/i.exec(t);
      if (shm) {
        var shName = titleCase(shm[1].toLowerCase());
        if (key(shName) !== key(section)) { section = shName; sectionsSeen[key(section)] = 1; }
        continue;
      }
      // The back cover's web address / copyright box ends whatever step ran
      // before it (Pattern Runway p9: 'www.patternrunway.com | e: …' was
      // carried into step 6 over the page break).
      if (BOILERPLATE_RE.test(t) || DISCLAIMER_RE.test(t.replace(/\s+/g, ''))) {
        cur = null; lastStep = null; justCrossedPage = false; pending = null;
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
          var joined = cur.text ? (cur.text + ' ' + t) : t;
          if (joined.length <= STEP_TEXT_CAP) {
            cur.text = joined;
          } else if ((cur.part || 1) < STEP_PARTS_MAX) {
            // A real printed step can run to 1,500 characters (Pattern Runway
            // step 6, Swoon's FINAL ASSEMBLY). Cutting it at the cap lost the
            // end of the instruction, so it carries on in a second card at a
            // sentence break instead (sewing-audit). Only a runaway past three
            // cards is still shortened.
            var at = sentenceBreak(joined, STEP_TEXT_CAP);
            cur.text = joined.slice(0, at).replace(/\s+$/, '');
            var more = pushStep({
              n: cur.n, section: cur.section,
              text: '(continued) ' + joined.slice(at).replace(/^\s+/, ''),
              page: typeof ln.page === 'number' ? ln.page : cur.page,
              marker: cur.marker, part: (cur.part || 1) + 1
            }, i);
            if (more) { if (more.part === 2) splitSteps++; cur = more; }
          } else {
            cur.text = joined.slice(0, STEP_TEXT_CAP).replace(/\s+\S*$/, '') + '…';
            truncated++;
          }
        }
      }
    }

    if (capped) warns.push('More than 200 steps were found — only the first 200 were kept.');
    if (splitSteps) {
      warns.push(splitSteps + (splitSteps === 1 ? ' long step carries' : ' long steps carry') +
        ' on over a second card.');
    }
    if (truncated) warns.push(truncated + (truncated === 1 ? ' step was' : ' steps were') + ' very long and got shortened.');
    if (candidates > 0 && jumped / candidates > 0.4) {
      warns.push('This PDF\'s columns may be interleaved' +
        (opts.columns ? ' (' + opts.columns + ' columns detected)' : '') +
        ' — check the steps.');
    }
    if (!steps.length) {
      // The booklet has a sewing-instructions section but numbers nothing and
      // titles nothing (Peppermint's magazine booklets, Riley Blake's free
      // bags): every paragraph inside that section is an operation. This is a
      // first-class path, not an error — but it stays inside the block, so the
      // cover blurb and the T&Cs page never become steps.
      var inner = paragraphSteps(lines, info, true);
      if (inner.steps.length) {
        steps = inner.steps;
        variations = variations.concat(inner.variations);
        warns.push('No numbered steps found — each paragraph of the sewing instructions was made into a step.');
      } else if (opts.fallback) {
        var all = paragraphSteps(lines, info, false);
        steps = all.steps;
        variations = variations.concat(all.variations);
        if (steps.length) warns.push('No numbered steps found — each paragraph was made into a step.');
      }
      if (!steps.length) {
        warns.push('No numbered steps found — the text was kept so you can add steps yourself.');
      }
    }
    // Variation / hack pages printed outside the instructions (05 #3, Wave F).
    if (stepsOnly && steps.length) {
      var haveVar = {};
      steps.concat(variations).forEach(function (r) { haveVar[key(r.text)] = 1; });
      optionalPages(lines, kinds, owners).forEach(function (r) {
        if (haveVar[key(r.text)] || variations.length >= 200) return;
        haveVar[key(r.text)] = 1;
        variations.push(r);
      });
    }
    if (variations.length) {
      warns.push(variations.length + (variations.length === 1 ? ' paragraph looks' : ' paragraphs look') +
        ' like pattern variations or care notes — they are not counted as steps.');
    }

    Object.defineProperty(steps, 'warnings', { value: warns, enumerable: false, configurable: true });
    Object.defineProperty(steps, 'firstIndex', { value: firstIndex, enumerable: false, configurable: true });
    Object.defineProperty(steps, 'variations', { value: variations, enumerable: false, configurable: true });
    return steps;
  }

  // --- Paragraph candidates (the "no numbered steps" recovery path) --------
  //
  // Research risk #1: a minority of respected publishers number nothing. The
  // fallback is therefore a first-class path, not an error: every paragraph in
  // the booklet becomes a *candidate*, scored so the construction prose starts
  // ticked and the reference matter starts unticked, and the user fixes the rest
  // in the picker.

  var IMPERATIVE_OPENER_RE = /^(?:sew|pin|fuse|prep|prepare|place|lay|press|stitch|fold|cut|trim|attach|turn|topstitch|baste|gather|hem|insert|finish|clip|understitch|edgestitch)\b/i;
  // (sewing-audit) 'Prep your rectangles by fusing fabric A to the fusible
  // fleece' is Riley Blake's first step and scored zero without these.
  var IMPERATIVE_ANY_RE = /\b(?:sew|sewn|sewing|fuse|fused|fusing|pin|pinned|press|pressed|pressing|stitch|stitched|stitching|fold|folded|cut|trim|attach|turn|topstitch|baste|basting|gather|gathered|hem|hemming|insert|finish|clip|understitch|edgestitch|overlock|serge|staystitch|slipstitch|tack|notch)\b/i;
  var SEW_VOCAB_RE = /\b(?:right sides? together|wrong sides? together|rst|seam allowances?|raw edges?|seams?|hemline|notch(?:es)?|interfacing|facings?|selvages?|selvedges?|darts?|zips?|zippers?|neckline|armholes?|waistband|lining|bodice|cuffs?|collar|pocket)\b/i;
  var PROSE_ABOUT_RE = /\b(?:we recommend|please note|you may wish|this pattern|our patterns|all rights reserved|copyright|print at home|test square|thank you|share your|before you start|tag us|hashtag)\b/i;
  var EXCLUDED_KIND = { cut: 1, notions: 1, fabric: 1, size: 1, skip: 1 };

  /**
   * How much a paragraph looks like a construction step. Imperative openers
   * ('Sew', 'Press', 'Understitch'…) are the strongest signal there is.
   */
  function paragraphScore(text, excluded) {
    var t = str(text, '');
    var s = 0;
    if (IMPERATIVE_OPENER_RE.test(t)) s += 3;
    if (IMPERATIVE_ANY_RE.test(t)) s += 1;
    if (SEW_VOCAB_RE.test(t)) s += 1;
    if (t.length >= 100) s += 1;
    if (PROSE_ABOUT_RE.test(t)) s -= 2;
    if (t.split(/\s+/).length < 6) s -= 2;
    var digits = t.replace(/[^\d]/g, '').length;
    if (digits > t.length * 0.25) s -= 2;
    if (excluded) s -= 3;
    return s;
  }

  var PARA_CAP = 300;

  /**
   * Sewing.paragraphCandidates(text, blocks) -> [{ text, page, section, score, defaultOn }]
   *
   * A paragraph ends at a blank line, at a heading, and at a `=== PAGE n ===`
   * marker ONLY when the text before it finished a sentence and the text after
   * it starts a new one — otherwise a step that runs over a page break would be
   * torn in half. PdfText prints a blank line immediately before every page
   * marker, so that blank defers to the page rule instead of flushing.
   */
  function paragraphCandidates(input, blocks) {
    var lines = toLines(input);
    var info = blocks || classify(lines);
    var kinds = info.kinds, heads = info.heads;
    var out = [];
    var buf = '', section = '', page = null, excluded = false, inSteps = false, prevDek = false;
    // When the booklet names its construction section, nothing outside it starts
    // ticked: the cover blurb and the "before you start" page are not steps.
    var hasSteps = info.hasSteps || hasStepsBlock(kinds);

    function nextContent(from) {
      for (var j = from; j < lines.length; j++) {
        if (lines[j].pageMark) return lines[j];
        if (lines[j].text && !(/^[\d\s.\/"'x×-]+$/.test(lines[j].text) && /\d/.test(lines[j].text))) return lines[j];
      }
      return null;
    }
    function flush() {
      var t = buf.replace(/^\s+|\s+$/g, '');
      buf = '';
      if (!t || out.length >= PARA_CAP) return;
      var sc = paragraphScore(t, excluded);
      out.push({
        text: t.slice(0, STEP_TEXT_CAP),
        page: page,
        section: section,
        inSteps: inSteps,
        score: sc,
        defaultOn: !excluded && t.length >= 40 && sc >= 1 && (!hasSteps || inSteps)
      });
    }

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], t = ln.text, k = kinds[i];
      if (ln.pageMark) {
        var nxt = nextContent(i + 1);
        var prevEnds = /[.!?:]["')]?$/.test(buf.replace(/\s+$/, ''));
        var nextStarts = !!(nxt && nxt.text && /^[A-Z0-9"'(]/.test(nxt.text));
        if (!buf || (prevEnds && nextStarts)) flush();
        continue;
      }
      if (!t) {
        var after = nextContent(i + 1);
        if (after && after.pageMark) continue;   // the blank PdfText prints before a page marker
        flush();
        continue;
      }
      // A magazine dek set in capitals under each pocket's name ('THE CLASSIC
      // POCKET COMES IN TWO SIZES – …' / 'TOO CUTE!') is a description, not
      // an operation, and its tail is not a section. The short name above it
      // ('Classic pocket') IS the section (Peppermint apron, sewing-audit).
      var isDekLine = !/[a-z]/.test(t) && /[A-Z]{2,}/.test(t) &&
        ((t.length >= 40 && t.split(/\s+/).length >= 6) || (prevDek && !/^[A-Z0-9 ]+:$/.test(t)));
      if (isDekLine && !stepMarker(t)) { flush(); prevDek = true; continue; }
      prevDek = false;
      var nxDek = nextContent(i + 1);
      if ((!buf || /[.!?]["')]?$/.test(buf)) && t.length <= 30 && /[a-z]/.test(t) && !/[.!?:]$/.test(t) && nxDek && nxDek.text &&
          !/[a-z]/.test(nxDek.text) && nxDek.text.length >= 40 && nxDek.text.split(/\s+/).length >= 6) {
        flush();
        section = prettyHeading(t);
        continue;
      }
      if (k === 'head') {
        // Every heading names a section here, including 'Glossary' and 'Notions':
        // the picker shows those paragraphs (unticked) so the user can rescue one.
        flush();
        section = prettyHeading(heads[i]);
        continue;
      }
      // A diagram's dimension labels ('.5" .5"', Riley Blake p2-p3) are not
      // prose; kept in, they glued two paragraphs together at the page break.
      if (/^[\d\s.\/"'x×-]+$/.test(t) && /\d/.test(t)) continue;
      if (!buf) {
        page = typeof ln.page === 'number' ? ln.page : null;
        excluded = !!EXCLUDED_KIND[k];
        inSteps = (k === 'steps');
      }
      buf = buf ? (buf + ' ' + t) : t;
      // Many booklets print no blank line between paragraphs at all, so the only
      // trace of the break left in the text is that the line ENDS a sentence
      // while the next line STARTS one. Inside running prose a sentence almost
      // always ends mid-line, so this is a good-enough paragraph break — and it
      // is the difference between "one 2,000-character step" and one step per
      // operation. Held back until the paragraph is worth splitting.
      if (buf.length >= 90 && /[.!?][")']?$/.test(t)) {
        var follow = nextContent(i + 1);
        if (follow && !follow.pageMark && follow.text && /^[A-Z("']/.test(follow.text) &&
            !BULLET_RE.test(follow.text)) {
          flush();
          continue;
        }
      }
      if (buf.length > STEP_TEXT_CAP * 2) flush();
    }
    flush();
    return out;
  }

  /**
   * Fallback for booklets with no numbered steps: the default-on paragraphs.
   * `onlySteps` keeps to the paragraphs inside a recognised sewing-instructions
   * block. Variation / care paragraphs come back separately (05 #2).
   */
  function paragraphSteps(lines, blocks, onlySteps) {
    var cands = paragraphCandidates(lines, blocks);
    var out = [], vars = [];
    for (var i = 0; i < cands.length && out.length < 200; i++) {
      var c = cands[i];
      if (!c.defaultOn) continue;
      if (onlySteps && !c.inSteps) continue;
      var row = {
        n: 0, section: c.section, text: c.text,
        page: c.page, marker: 'none', optional: VARIATION_RE.test(c.section)
      };
      if (row.optional) { if (vars.length < 200) vars.push(row); continue; }
      row.n = out.length + 1;
      out.push(row);
    }
    return { steps: out, variations: vars };
  }

  var SENT_DOT = '\u0001';

  /**
   * Sewing.sentences(text) -> string[]  (lossless: join(' ') gives the text back)
   * Used by the picker's "split here" control. '1.5 cm' is one sentence.
   */
  function sentencesOf(text) {
    var t = str(text, '').replace(/^\s+|\s+$/g, '');
    if (!t) return [];
    var flat = t.replace(/(\d)\.(\d)/g, '$1' + SENT_DOT + '$2');
    var re = /[^.!?]*[.!?]+["')\]]*(?:\s+|$)|[^.!?]+$/g;
    var out = [];
    var m;
    while ((m = re.exec(flat))) {
      if (!m[0]) { re.lastIndex++; continue; }
      var one = m[0].split(SENT_DOT).join('.').replace(/^\s+|\s+$/g, '');
      // '…and press. (Figure 1) Finally, …': the figure reference closes the
      // sentence before it, so a split there must not carry it onto the next
      // card (Samford, Wave F).
      var fig = out.length ? /^\((?:fig(?:ure)?s?\.?|diagram|illustration|see)[^()]{0,30}\)\s*/i.exec(one) : null;
      if (fig) {
        out[out.length - 1] += ' ' + fig[0].replace(/\s+$/, '');
        one = one.slice(fig[0].length).replace(/^\s+/, '');
      }
      if (one) out.push(one);
      if (out.length >= 200) break;
    }
    return out.length ? out : [t];
  }

  // =====================================================================
  // 5. Cutting list
  // =====================================================================

  var C_SUBCUT = /^sub-?\s?cut\s+(?:into\s+)?\(?\s*(\d{1,4})\s*\)?\s*(.*)$/i;
  // Quilting cutting tables, as Art Gallery Fabrics and FreeSpirit print them:
  //   'seven (7) 10 1/2" x 4 1/2" rectangles from fabric A.'
  //   '(4) 3 1/2" x WOF; subcut'        '(7) 2 1/2" x WOF for binding'
  //   '(24) 3 1/2" squares'             'One (1) template 1 from fabric R.'
  // The spelled-out count in front of the digits is decoration; the digits win.
  var C_SHAPE = 'squares?|rectangles?|strips?|triangles?|pieces?|blocks?|units?|panels?|' +
    'circles?|hexagons?|hexies?|diamonds?|borders?|bindings?|sashing|binding\\s+strips?';
  var C_WOF_DIMS = new RegExp('^(?:[a-z][a-z\\- ]{2,23}\\s+)?\\(?\\s*(\\d{1,4})\\s*\\)?\\s+(?:each\\s+)?' +
    '([\\d][\\d \\/".x×-]*?)\\s*[x×]\\s*(?:WOF|width\\s+of\\s+(?:the\\s+)?fabric)\\b(.*)$', 'i');
  var C_COUNT_DIMS = new RegExp('^(?:[a-z][a-z\\- ]{2,23}\\s+)?\\(?\\s*(\\d{1,4})\\s*\\)?\\s+(?:each\\s+)?' +
    '([\\d][\\d \\/".x×a-z¹²³⁰-⁹-]*?)\\s*(' + C_SHAPE + ')\\b(.*)$', 'i');
  var C_COUNT_PAREN = /^(?:[a-z][a-z\- ]{2,23}\s+)?\(\s*(\d{1,4})\s*\)\s+(?:each\s+)?(.{2,60})$/i;
  // 'Cut x 1 front on the fold.' — Peppermint's cutting lists, several to a line.
  var C_CUT_X = /^cut\s*[x×]\s*\(?\s*(\d{1,3})\s*\)?\s+(.{2,60})$/i;
  var C_STRIPS = /^\(?\s*(\d{1,3})\s*\)?\s+strips?\s+(.+?)\s*[x×]\s*(?:WOF|width of fabric)\b(.*)$/i;
  var C_FROM_CUT = /^(?:from\s+(.{2,40}?)\s*[,:]\s*)?cut\s*\(?\s*(\d{1,4})\s*\)?\s*(?:[-—:]\s*)?(.*)$/i;
  var C_PIECE_CUT = /^(.{2,48}?)\s*(?:—|-|:)?\s*\bcut\s*\(?\s*(\d{1,3})\s*\)?(?![\d\/])(.*)$/i;
  var C_N_X_PIECE = /^\(?\s*(\d{1,3})\s*\)?\s*[x×]\s*(.{2,48}?)(?:\s*[-—(](.*))?$/i;
  var C_PIECE_X_N = /^(.{2,48}?)\s*[x×]\s*\(?\s*(\d{1,3})\s*\)?\b(.*)$/i;
  var C_FROM_LINE = /^from\s+(?:the\s+)?(.{2,40}?)\s*[,:.]?\s*$/i;
  // What follows the count when the line is prose rather than a cutting row.
  var CUT_REST_BAD = /^\s*(?:x\b|only\b|of\b|each\b|more\b|time|times\b)/i;
  // A "piece name" that is really the tail of a sentence.
  // Cutting diagrams are captioned with the same words as the rows above them.
  var CUT_CAPTION_RE = /\b(?:diagram|as shown|shown in|see page|template patterns|on point|indicated)\b/i;
  var CUT_PIECE_BAD = /^(?:layout|fold|unfold|re\s*fold|then|and|or|to|please|note|you|we|this|these|those|first|next|now|after|before|position|place|turn|use|using|make|do|see|when|if|with|for|from|it|is|are|be|the|a|an)\b/i;

  var MATERIALS = [
    ['main', /\b(?:main|self|shell|outer|exterior|fashion fabric)\b/i],
    ['lining', /\blinings?\b/i],
    // Pellon's brand names are how bag patterns spell "interfacing".
    ['interfacing', /\b(?:interfacing|interlining|fusible|sf-?101|shape ?flex|soft and stable|fusible fleece|foam|stabili[sz]er|pellon|peltex|decor ?bond|flex ?foam)\b/i],
    ['contrast', /\b(?:contrast(?:ing)?|accent|binding)\b/i],
    ['batting', /\b(?:batting|wadding)\b/i],
    // Quilts run past fabric H: Catwalk goes to R, Harmony to P.
    ['other', /\b(?:background|backing|fabric\s+[a-z]\b)/i]
  ];
  var MATERIAL_SET = { main: 1, lining: 1, interfacing: 1, contrast: 1, batting: 1, other: 1 };

  // 'bias binding' and 'bias tape' are a notion on an apron, not a quilt's
  // contrast binding fabric, so they are taken off the line before matching.
  var BIAS_RE = /\bbias\s+(?:binding|tape)\b/gi;

  function materialOf(s) {
    s = str(s, '').replace(BIAS_RE, ' ');
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
    // '(4) each D¹ and D², oriented as shown in the cutting diagram': the
    // placement clause is advice, and it used to make the whole row read as a
    // figure caption (FreeSpirit Harmony, sewing-audit).
    s = s.replace(/,\s*(?:oriented|noting|centered|centred)\b.*$/i, '');
    if (!s) return null;

    var qty = null, piece = '', rest = '', fromHere = null, quilty = false;
    var m;
    // '6 3/4" tall x 7 5/8" wide B rectangle: Cut 4' starts with a mixed
    // number, not with a count of six.
    var mixedLead = MIXED_LEAD_RE.test(s);

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
    } else if (!mixedLead && (m = C_WOF_DIMS.exec(s))) {
      // '(4) 3 1/2" x WOF; subcut' — one spelling of the WOF strip row; the
      // piece name is normalised so both spellings group together (05 #14).
      qty = parseInt(m[1], 10);
      piece = cleanPiece(m[2]) + ' x WOF strip';
      rest = (m[2] || '') + ' ' + (m[3] || '');
      quilty = true;
    } else if (!mixedLead && (m = C_COUNT_DIMS.exec(s))) {
      qty = parseInt(m[1], 10);
      piece = singular(cleanPiece(m[2] + ' ' + m[3]));
      rest = m[4] || '';
      quilty = true;
    } else if ((m = C_CUT_X.exec(s))) {
      qty = parseInt(m[1], 10);
      rest = m[2] || '';
      piece = cleanPiece(rest.replace(/\s+on\s+(?:the\s+)?fold\b.*$/i, '')
        .replace(/\bfrom\s+(?:the\s+)?[a-z0-9 ]{2,24}$/i, ''));
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
    } else if ((m = C_COUNT_PAREN.exec(s))) {
      // '(1) template 1 from fabric R' — a parenthesised count is explicit
      // enough to trust even when the piece is not a named quilting shape.
      qty = parseInt(m[1], 10);
      rest = m[2] || '';
      piece = cleanPiece(rest.replace(/\bfrom\s+(?:the\s+)?[a-z0-9 ]{2,24}$/i, ''));
      quilty = true;
    } else if ((m = C_PIECE_X_N.exec(s))) {
      piece = cleanPiece(m[1]);
      qty = parseInt(m[2], 10);
      rest = m[3] || '';
      // 'Cut Size: 3/4" x 7"' is a finished size, not "seven of something": a
      // count is never followed by an inch mark, a unit or a fraction.
      if (/^\s*(?:"|''|cm\b|mm\b|in\b|inch|\/\d)/.test(rest)) return null;
    } else {
      return null;
    }

    if (qty === null || isNaN(qty) || qty < 1 || qty > 9999) return null;

    // 'Cut 1 pair of pockets' / 'Pocket: cut 1 pair' is two mirrored pieces.
    // The count is always in pieces (what the chips count, Wave F); the
    // pair is remembered in `grain` so the cutting list can say "1 pair".
    var pair = false;
    var PAIR_LEAD = /^\s*pairs?\b(?:\s+of\b)?\s*/i;
    if (PAIR_LEAD.test(piece)) { piece = cleanPiece(piece.replace(PAIR_LEAD, '')); pair = true; }
    else if (PAIR_LEAD.test(rest) && !/\bpairs?\b/i.test(piece)) pair = true;
    if (pair) qty = Math.min(9999, qty * 2);

    var scan = s + ' ' + (from || '');
    var note = parensNote(s);
    var material = materialOf(rest) || materialOf(s) || materialOf(from) || 'main';
    // Under 'Fabric H, cut:' the row comes off fabric H, whatever the row
    // says it is for ('… x WOF for outer border', '… for binding').
    if (/^fabric\s+[a-z]{1,2}\b/i.test(str(from, '')) && material !== 'lining' && material !== 'interfacing') material = 'other';
    if (material === 'other') {
      var lab = /\bfabric\s+[a-z]\b/i.exec(rest) || /\bfabric\s+[a-z]\b/i.exec(s) || /\bfabric\s+[a-z]\b/i.exec(str(from, '')) ||
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
    // A figure caption is not a piece: 'Fabric B cutting diagram',
    // '... oriented as shown in the cutting diagram'.
    if (CUT_CAPTION_RE.test(piece)) return null;
    // 'Cut x 1 length of 12mm elastic to the size chart' sits in a step and
    // is a notion cut to length, not a pattern piece (Peppermint bathers).
    if (/\belastic\b|^length\b|\bchart\b/i.test(piece)) return null;

    return {
      piece: piece,
      qty: qty,
      material: material,
      onFold: FOLD_RE.test(s),
      grain: grainM ? grainM[0].toLowerCase() : (pair ? 'pair' : ''),
      dims: dimsM ? dimsM[0].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') : '',
      note: note,
      subcut: false,
      line: line
    };
  }

  // 'Cut x 1 front on the fold. Cut x 1 back on the fold.' and 'Cut (2) … from
  // fabric A. Then cut (2) … from fabric B.' — two or three cut rows printed as
  // one sentence-per-piece line.
  var MIXED_LEAD_RE = /^(?:[a-z][a-z\- ]{2,23}\s+)?\d{1,3}\s+\d{1,2}\/\d{1,2}\s*(?:"|''|in\b|inch|cm\b)/i;
  // A cutting-diagram caption: '… B rectangle: Cut 4', 'Fabric D - D and D:
  // Cut 4 each'. In a table whose rows lead with '(4)' they repeat a row.
  var DIAGRAM_CUT_RE = /^[^:]{3,80}:\s*cut\s+\d{1,3}\b/i;
  var PAREN_LEAD_RE = /^\(\s*\d{1,4}\s*\)\s/;
  var CUT_SENT_SPLIT = /\.\s+(?=(?:then\s+)?cut\b)/i;
  var CUT_PREFIX_RE = /^(.{2,40}?):\s*(cut\b.*)$/i;
  var CUT_SOURCE_RE = /^(.{2,32}?)\s*,\s*(?:fussy\s+)?cut\s*:?\s*$/i;
  var SUBCUT_TAIL_RE = /\bsub-?\s?cut\b\s*\.?\s*$/i;
  // A "piece name" that only says what the piece is made OF. The pattern sheets
  // print the piece name once as a label and then 'Cut 2 Lining Fabric' under
  // it, so the label is the name the sewist is looking for.
  var MATERIAL_ONLY_PIECE = new RegExp('^(?:on\\s+(?:the\\s+)?fold|fold|piece|pieces|' +
    'cut|[a-z0-9®\'\\- ]*\\b(?:fabric|lining|exterior|interfacing|pellon|shape\\s?-?flex|peltex|' +
    'batting|wadding|fleece|stabili[sz]er|interlining|main|self|contrast|felt)s?\\b[a-z0-9®\'\\- ]*)$', 'i');

  /** A standalone piece label near a cutting row, or ''. */
  // Brand stamps and material words scattered across a pattern sheet.
  var SHEET_JUNK_RE = /^(?:pellon|peltex|shape-?\s?flex|fold|interfacing|stabili[sz]er|lining|exterior)$/i;
  var SIZE_RUN_RE = /SIZE\s?(?:\d{1,2}\s?[MTY]?|[2-9]?X{0,3}[SML])(?=SIZE|\s|$)/g;
  var SIZE_RUN_TEST = /^(?:\s*SIZE\s?(?:\d{1,2}\s?[MTY]?|[2-9]?X{0,3}[SML]))+\s*$/;

  /** A sheet label without its overprinted size-layer labels. */
  function sheetClean(t) {
    return str(t, '').replace(SIZE_RUN_RE, ' ')
      .replace(/\b(cut\s*\d{1,3})(?=[A-Za-z])/i, '$1 ')
      .replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function labelCandidate(t) {
    var s = str(t, '').replace(/^\s+|\s+$/g, '').replace(/[.,;:]+$/, '');
    if (s.length < 3 || s.length > 40) return '';
    if (!/[A-Za-z]{3}/.test(s)) return '';
    if (/^[a-z]+$/.test(s)) return '';                       // 'swoon' — a brand mark
    if (stepMarker(s)) return '';
    if (isHeading(s) && headingKind(headingText(s))) return '';
    s = s.replace(/\b(?:place\s+on\s+(?:the\s+)?fold|cut\s+on\s+(?:the\s+)?fold|on\s+the\s+fold|fold)\b/gi, ' ')
      .replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
    return s.length >= 3 ? s : '';
  }

  /** parseCutting(lines) -> CutRow[] (de-duplicated), with a non-enumerable `.warnings`. */
  function parseCutting(input) {
    var lines = toLines(input);
    var out = [];
    var warns = [];
    var seen = {};
    var from = null, label = '', wofPending = false;
    var parenRows = 0;
    for (var pr0 = 0; pr0 < lines.length; pr0++) if (PAREN_LEAD_RE.test(lines[pr0].text || '')) parenRows++;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].text;
      if (!t) continue;
      if (parenRows >= 3 && DIAGRAM_CUT_RE.test(t) && !PAREN_LEAD_RE.test(t)) continue;
      // 'Fabric D, cut:' / 'Fabric B, fussy cut:' names the fabric every row
      // beneath it comes off — which is how a quilter works (05 #8).
      var src = CUT_LABEL_RE.test(t) ? CUT_SOURCE_RE.exec(t) : null;
      if (src) {
        from = titleCase(src[1].replace(/\*+$/, '').replace(/^\s+|\s+$/g, ''));
        wofPending = false;
        continue;
      }
      var fm = C_FROM_LINE.exec(t);
      if (fm && !/\bcut\b/i.test(t)) { from = fm[1]; wofPending = false; continue; }

      // A row wrapped onto the next printed line: '… rectangles from' / 'fabric
      // L.' and '… squares' / 'from fabric B.' Without the join the row loses the
      // fabric it comes off.
      if (i + 1 < lines.length && lines[i + 1].text && t.length < 110) {
        var nxt = lines[i + 1].text;
        if ((/\b(?:from|and|of|the|x)$/i.test(t) && nxt.length <= 30) ||
            (/^from\b/i.test(nxt) && nxt.length <= 30)) {
          t = t + ' ' + nxt;
          i++;
        }
      }
      var lineFrom = from;
      var body = t;
      var prefixLabel = '';
      var pm = CUT_PREFIX_RE.exec(t);
      if (pm) { lineFrom = (from ? from + ' ' : '') + pm[1]; body = pm[2]; prefixLabel = labelCandidate(pm[1]); }
      var parts = body.split(CUT_SENT_SPLIT);
      var madeRow = false;
      for (var q = 0; q < parts.length; q++) {
        var seg = parts[q].replace(/^\s*then\s+/i, '').replace(/^\s+|\s+$/g, '');
        if (!seg) continue;
        var row = cutRow(seg, lineFrom);
        if (!row) continue;
        madeRow = true;
        if (MATERIAL_ONLY_PIECE.test(row.piece) && (prefixLabel || label)) row.piece = prefixLabel || label;
        if (/\belastic\b|\bchart\b/i.test(row.piece)) continue;
        var isWof = /x WOF strip$/.test(row.piece);
        if (wofPending && !isWof) {
          row.subcut = true;
          if (row.note.indexOf('subcut') < 0) row.note = row.note ? (row.note + ', subcut') : 'subcut';
        }
        if (/^sub-?\s?cut\b/i.test(seg)) row.subcut = true;
        wofPending = isWof ? SUBCUT_TAIL_RE.test(seg) : wofPending;
        // The fabric a piece comes off is part of its identity: without it the
        // Catwalk quilt's eighteen '2 1/2" square' rows collapse into one.
        // (key() drops superscripts, and 'K¹ rectangle' / 'K² rectangle' are
        // two different pieces.)
        var k = key(row.piece) + '|' + (row.piece.match(/[¹²³⁴-⁹]/g) || []).join('') + '|' +
          row.qty + '|' + row.material + '|' + key(row.note);
        if (seen[k]) {
          // The same 'Cut x 1 front on the fold' under a different group
          // ('Bikini Top' / 'Bikini Briefs') is a different piece: both get
          // the group they sit in, and neither is lost (sewing-audit).
          var first = seen[k];
          if (!label || first.label === label || key(label) === key(row.piece) ||
              /\d|\bpage\b|\bcutting\b|\bdiagram\b/i.test(label)) continue;
          if (!first.row.note) first.row.note = first.label || '';
          row.note = row.note ? (row.note + ', ' + label) : label;
          k = k + '|' + key(label);
          if (seen[k]) continue;
        }
        seen[k] = { label: label, row: row };
        out.push(row);
        if (out.length >= 400) break;
      }
      if (!madeRow) {
        var lc = labelCandidate(t);
        if (lc) label = lc;
      }
      if (/^from\s+/i.test(t)) {
        var inline = /^from\s+(.{2,40}?)\s*[,:]\s*cut\b/i.exec(t);
        if (inline) from = inline[1];
      }
      if (out.length >= 400) break;
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
    'bra cups?', 'foam cups?', 'sliders?', 'rings?',
    'elastic', 'bias binding', 'bias tape', 'twill tape', 'interfacing', 'interlining',
    'fusing', 'fusible[a-z ]*', 'webbing', 'd-?rings?', 'o-?rings?', 'rectangle rings?',
    'swivel hooks?', 'swivel clasps?', 'triglides?', 'sliders?', 'rivets?', 'grommets?',
    'eyelets?', 'drawstrings?', 'cords?', 'cord stops?', 'toggles?', 'velcro',
    'hook-and-loop', 'boning', 'shoulder pads?', 'labels?', 'batting', 'wadding',
    'basting spray', 'safety pins?', 'walking foot', 'zipper foot', 'needles?',
    'rotary blades?', 'stabili[sz]ers?', 'shape ?flex', 'sf-?101', 'soft and stable'
  ].join('|') + ')\\b', 'i');

  var TOOL_ITEM_RE = /\b(?:scissors|shears|tape measure|sewing machine|iron|pins|chalk|marking pen|ruler|snips|bodkin|seam ripper|rotary cutter|cutting mat)\b/i;

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
    yd: 1, yds: 1, yard: 1, yards: 1, of: 1, approx: 1,
    pair: 1, pairs: 1, packet: 1, packets: 1, roll: 1, reel: 1, spool: 1, set: 1, sets: 1
  };

  // What may follow the notion noun on a loose line. 'Lightweight fusing' is a
  // notion; 'Interfacing overtop' is the middle of a sentence about fusing one.
  var LOOSE_TAIL_OK = {
    tape: 1, binding: 1, fabric: 1, thread: 1, cord: 1, elastic: 1, fleece: 1, foam: 1,
    stabiliser: 1, stabilizer: 1, interfacing: 1, snap: 1, snaps: 1, wide: 1, long: 1,
    optional: 1, each: 1, colour: 1, color: 1, matching: 1, match: 1, to: 1, or: 1, and: 1,
    of: 1, in: 1, desired: 1, needed: 1, required: 1, set: 1, pair: 1, pairs: 1, hook: 1,
    eye: 1, loop: 1, foot: 1, needle: 1, needles: 1, blade: 1, blades: 1, spray: 1, pins: 1,
    snips: 1, scissors: 1, clips: 1, marker: 1, pen: 1, pencil: 1, chalk: 1, ruler: 1,
    away: 1, weight: 1, tape: 1, glue: 1, rectangles: 1, rectangle: 1, squares: 1,
    square: 1, strips: 1, strip: 1, pieces: 1, piece: 1, panels: 1, panel: 1
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
    // Whatever trails the noun has to read like part of the item, not like prose.
    var after = s.slice(m.index + m[0].length).toLowerCase()
      .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (after) {
      var tail = after.split(/\s+/);
      for (var a = 0; a < tail.length; a++) {
        var w = tail[a];
        if (!w || /^\d+$/.test(w) || LOOSE_TAIL_OK[w] || LOOSE_LEAD[w]) continue;
        // 'Shapeflex/SF101': a second name for the same product (Riley Blake).
        if (NOTION_VOCAB.test(w)) continue;
        // '12mm', '1yd': a measurement glued to its unit is part of the item.
        if (/^\d+(?:\.\d+)?(?:mm|cm|m|in|inch|inches|yd|yds|yard|yards)$/.test(w)) continue;
        return false;
      }
    }
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
    // 'foam bra cups' are cups, not foam interfacing; 'a pair of rings' for
    // swim straps is hardware (Peppermint bathers, sewing-audit).
    if (/\b(?:bra|foam)\s+cups?\b/i.test(text)) return 'notion';
    if (/\bpairs?\s+of\s+rings?\b/i.test(text)) return 'hardware';
    if (INTERFACING_RE.test(text)) return 'interfacing';
    if (HARDWARE_RE.test(text)) return 'hardware';
    return 'notion';
  }

  var AMOUNT_BULLET_RE = /^[-•*]\s*\d+(?:[.,]\d+)?\s*(?:m|cm|mm|yards?|yds?)\b/i;

  /**
   * 'Narrow elastic width – 6mm or ¼ wide' over '- 5m or 5 ½ yards for sizes
   * XS to 5X' / '- 6m or 6 ½ yards for sizes 6X to 9X' (Peppermint bathers):
   * the bullets are the quantities OF the line above, not items of their own.
   * They become one item. A left-column label glued onto the first line
   * ('NOTIONS Narrow elastic…') is taken off (sewing-audit).
   */
  function mergeAmountBullets(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = (ln.text || '').replace(/^(?:NOTIONS|HABERDASHERY|SUPPLIES)\s+(?=\S)/, '');
      if (t !== ln.text) ln = { text: t, page: ln.page, pageMark: ln.pageMark };
      if (t && !ln.pageMark && !BULLET_RE.test(t) && t.length <= 60 && i + 1 < lines.length &&
          lines[i + 1].text && AMOUNT_BULLET_RE.test(lines[i + 1].text)) {
        var parts = [];
        while (i + 1 < lines.length && lines[i + 1].text && AMOUNT_BULLET_RE.test(lines[i + 1].text)) {
          // '5m or 5 1/2 yards for sizes XS to 5X' -> '5m for XS to 5X', so
          // the item stays one readable line.
          parts.push(lines[i + 1].text.replace(BULLET_RE, '')
            .replace(/\s+or\s+[\d\s\/.]+(?:yards?|yds?|inch(?:es)?|")/i, '')
            .replace(/\bfor\s+sizes\b/i, 'for').replace(/^\s+|\s+$/g, ''));
          i++;
        }
        out.push({ text: '- ' + t + ': ' + parts.join('; '), page: ln.page });
        continue;
      }
      out.push(ln);
    }
    return out;
  }

  /**
   * parseNotions(lines, opts) -> NotionRow[]
   * opts.inBlock (default true): every non-heading 3-90 char line becomes a row.
   * opts.inBlock === false: only lines matching the notion vocabulary.
   */
  function parseNotions(input, opts) {
    opts = opts || {};
    var inBlock = opts.inBlock !== false;
    var lines = mergeAmountBullets(toLines(input));
    var out = [];
    var warns = [];
    var seen = {};
    // When the block is a bulleted list, only the bullets are the list. Swoon's
    // materials column has the diagram's captions ('Where to stitch', the brand
    // mark) interleaved through it, and they are never bulleted.
    var bulleted = 0;
    for (var b = 0; b < lines.length; b++) {
      if (lines[b].text && BULLET_RE.test(lines[b].text)) bulleted++;
    }
    var bulletsOnly = inBlock && bulleted >= 3;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.text;
      if (!t || ln.pageMark) continue;
      // A wrapped item: '2" (5cm) Elastic (Use provided elastic chart for' /
      // 'length)'. An unclosed bracket is the giveaway.
      // ('– see page 108)' wraps the Peppermint apron's pattern line.)
      if (inBlock && out.length && /^(?:-\s+)?[a-z(]/.test(t) && t.length <= 60) {
        var prevText = out[out.length - 1].text;
        var opens = prevText.split('(').length - 1, closes = prevText.split(')').length - 1;
        if (opens > closes) {
          out[out.length - 1].text = (prevText + ' ' + t).slice(0, 160);
          continue;
        }
      }
      if (bulletsOnly && !BULLET_RE.test(t) && !NOTION_LABEL_RE.test(t)) continue;
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

  var DOT_MARK = '\u0002';
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

  // Nobody sews at 44 inches. A stacked fraction whose numerator was lost
  // ('Use a /4" seam allowance') reads as a plausible number and a real unit, so
  // the only defence is knowing what a seam allowance can be: 1 mm to 50 mm.
  var SA_MIN_MM = 1, SA_MAX_MM = 50;

  function saPlausible(value, unit) {
    var mm = toMm(value, unit);
    return mm !== null && mm >= SA_MIN_MM && mm <= SA_MAX_MM;
  }

  function saMeasure(sentence) {
    for (var i = 0; i < SA_RES.length; i++) {
      var m = SA_RES[i].exec(sentence);
      if (m && saPlausible(m[1], m[2])) return { value: m[1], unit: m[2].toLowerCase() };
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
        var anyTail = SA_ANY.exec(tail);
        var mTail = saMeasure(tail) ||
          ((anyTail && saPlausible(anyTail[1], anyTail[2])) ? { value: anyTail[1], unit: anyTail[2].toLowerCase() } : null);
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
      // A per-size ELASTIC chart ('Cut x 1 length of 6mm elastic to your size
      // below:' over 'XS S M … / CM 38 42 … / INCHES 15 16½ …', Peppermint
      // bathers) is not the body chart: its bare 'CM' / 'INCHES' rows are
      // named after the chart and kept with the other per-size rows, never as
      // body measurements (sewing-audit).
      var ctx = '';
      for (var cb = i - 1, seenCtx = 0; cb >= 0 && seenCtx < 2; cb--) {
        if (lines[cb].pageMark) break;
        if (lines[cb].text) { ctx += ' ' + lines[cb].text; seenCtx++; }
      }
      var elasticChart = /elastic/i.test(ctx) || /elastic/i.test(lastHead);
      if (elasticChart) {
        // Named by the heading right above it, or by the elastic's width when
        // the chart sits inside a step ('STEP 8: … LOWER EDGE …' / '12mm').
        var mmW = /(\d{1,2})\s*mm\b/i.exec(ctx);
        var chartName = (/elastic/i.test(lastHead) && ctx.indexOf(lastHead) >= 0)
          ? prettyHeading(lastHead) : 'Elastic' + (mmW ? ' ' + mmW[1] + 'mm' : '');
        rows = rows.map(function (r) {
          return /^(?:cm|mm|inch(?:es)?|in)$/i.test(r.label)
            ? { label: chartName + ' · ' + r.label.toLowerCase(), values: r.values } : r;
        });
        isFinished = true;
      }
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

  /**
   * Every yardage on a line, with dual-unit pairs kept together.
   * '1.9 m / 2 1/4 yd' is ONE amount printed twice, not two amounts; and a
   * trailing bare fraction belongs to the amount in front of it ('1yd 3/4').
   */
  function amountsIn(text) {
    var s = str(text, '');
    var raw = [];
    var m;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(s))) {
      raw.push({ at: m.index, end: m.index + m[0].length });
      if (raw.length >= 80) break;
    }
    AMOUNT_RE.lastIndex = 0;
    var out = [];
    for (var i = 0; i < raw.length && out.length < 40; i++) {
      var start = raw[i].at, end = raw[i].end;
      while (i + 1 < raw.length && /^\s*\/\s*$/.test(s.slice(end, raw[i + 1].at))) {
        i++;
        end = raw[i].end;
      }
      var frac = /^\s+\d{1,2}\s*\/\s*\d{1,2}(?![\d\/])/.exec(s.slice(end));
      if (frac && !(i + 1 < raw.length && raw[i + 1].at < end + frac[0].length)) end += frac[0].length;
      out.push({
        // "2.5yd" and "1.9 m" come out of PDFs side by side; give every amount
        // one space between the number and its unit so a table reads evenly.
        text: s.slice(start, end)
          .replace(/(\d)\s*(m|cm|yds?|yards?|metres?|meters?)\b/gi, '$1 $2')
          .replace(/\s+/g, ' ')
          .replace(/^\s+|\s+$/g, ''),
        at: start, end: end
      });
    }
    return out;
  }

  function amountTexts(text) {
    return amountsIn(text).map(function (a) { return a.text; });
  }

  var GROUP_TOKEN_RE = /^[A-Za-z0-9]{1,5}(?:[-\/][A-Za-z0-9]{1,5})*$/;
  var ALL_SIZES_RE = /\ball\s+sizes\b/i;
  var UNIT_WORD = '(?:m|cm|yds?|yards?|metres?|meters?)';
  var UNIT_LEGEND_RE = new RegExp('\\s*[-—]\\s*' + UNIT_WORD + '\\s*\\/\\s*' + UNIT_WORD + '\\b\\s*', 'i');

  /**
   * Sewing.sizeGroups(text, labels) -> number[][] | null
   *
   * Real booklets print yardage per size GROUP and head the columns with the
   * groups: 'Sizes 36-40  42-44', '36-38-40 42-44', '8/10/12 14/16',
   * 'XS-M  L-XL'. A two-part token is a RANGE across the size run; three or more
   * parts is an explicit list. The groups have to tile the size labels exactly
   * once each, in order — that is what tells a real header from a stray number.
   */
  function sizeGroups(text, labels) {
    if (!isArr(labels) || labels.length < 2) return null;
    var index = {};
    for (var i = 0; i < labels.length; i++) index[str(labels[i], '').toLowerCase()] = i;
    var toks = str(text, '').split(/\s+/);
    var multi = [], all = [];
    for (var k = 0; k < toks.length; k++) {
      var tok = toks[k].replace(/[(),:;.]/g, '');
      if (!tok || !GROUP_TOKEN_RE.test(tok)) continue;
      var parts = tok.split(/[-\/]/);
      var idx = [], ok = true;
      for (var pi = 0; pi < parts.length; pi++) {
        var at = index[parts[pi].toLowerCase()];
        if (at === undefined) { ok = false; break; }
        idx.push(at);
      }
      if (!ok) continue;
      var members;
      if (parts.length === 2) {
        var lo = Math.min(idx[0], idx[1]), hi = Math.max(idx[0], idx[1]);
        members = [];
        for (var q = lo; q <= hi; q++) members.push(q);
      } else {
        members = idx.slice();
      }
      all.push(members);
      if (parts.length > 1) multi.push(members);
    }
    return tiles(multi, labels.length) || tiles(all, labels.length);
  }

  /** The groups cover 0..n-1 exactly once each, in order. */
  function tiles(groups, n) {
    if (!groups.length) return null;
    var flat = [];
    for (var g = 0; g < groups.length; g++) flat = flat.concat(groups[g]);
    if (flat.length !== n) return null;
    for (var i = 0; i < n; i++) if (flat[i] !== i) return null;
    return groups;
  }

  /** Map a row's amounts onto one per size. */
  function expandAmounts(mine, labels, groups, allSizes) {
    var n = isArr(labels) ? labels.length : 0;
    if (!n) return { amounts: mine.slice(), grouped: false };
    if (!mine.length) return { amounts: [], grouped: false };
    if (mine.length === n) return { amounts: mine.slice(), grouped: false };
    var out, i;
    if (groups && groups.length === mine.length) {
      out = new Array(n);
      for (var g = 0; g < groups.length; g++) {
        for (var j = 0; j < groups[g].length; j++) out[groups[g][j]] = mine[g];
      }
      for (i = 0; i < n; i++) if (out[i] === undefined) return { amounts: [], grouped: false };
      return { amounts: out, grouped: true };
    }
    if (allSizes && mine.length === 1) {
      out = [];
      for (i = 0; i < n; i++) out.push(mine[0]);
      return { amounts: out, grouped: true };
    }
    // No header, but the columns divide the sizes evenly: split evenly.
    if (mine.length < n && n % mine.length === 0) {
      var per = n / mine.length;
      out = [];
      for (i = 0; i < n; i++) out.push(mine[Math.floor(i / per)]);
      return { amounts: out, grouped: true };
    }
    return { amounts: [], grouped: false };
  }

  // Precut units are an amount even though they carry no number of yards: 'F8'
  // is a fat eighth, 'FQ' a fat quarter, and a quilt's whole shopping list can
  // be written in them.
  var PRECUT_AMOUNT_RE = /(\d{1,2}\s*(?:fat\s+quarters?|fat\s+eighths?|charm\s+packs?|jelly\s+rolls?|layer\s+cakes?))|(\bF8\b|\bFQ\b)/i;
  var FAB_NOTE_RE = /\(([^)]{2,24})\)\s*$/;
  var FAB_UNIT_RE = /\b(?:yd|yds|yard|yards|m|cm|metre|metres|meter|meters)\b/i;
  var FAB_NAME_BAD = /^(?:yardage|requirements?|fabric\s+requirements?|design(?:\s+colou?r)?|colou?r|item\s+id|and|or|the|each|total|approx|note|notes|additional\s+recommendations?)$/i;

  /**
   * A fabric requirement with no bolt width: '<name> <amount>' (05 #4).
   * Quilt yardage never states a width (WOF is assumed), which is why the
   * quilter's entire shopping list used to parse to nothing. Runs only inside a
   * FABRIC / REQUIREMENTS block and only when the amount ENDS the line, so a
   * sentence that happens to mention yards is not a fabric row.
   */
  function plainFabricRow(t) {
    var s = str(t, '').replace(/^\s+|\s+$/g, '').replace(/\s*[.;]\s*$/, '');
    if (!s || s.length > 90 || !/[A-Za-z]/.test(s)) return null;
    if (isHeading(s) && headingKind(headingText(s))) return null;
    if (stepMarker(s)) return null;
    var note = '';
    var nm = FAB_NOTE_RE.exec(s);
    if (nm) note = nm[1];
    var amounts = amountsIn(s);
    // Without a bolt width to anchor it, only a LENGTH of fabric counts: '14"
    // zipper' in the same requirements block is a notion, not a fabric row.
    if (amounts.length && !FAB_UNIT_RE.test(amounts[0].text)) amounts = [];
    var name = '', amtTexts = [];
    if (amounts.length) {
      var last = amounts[amounts.length - 1];
      var tail = s.slice(last.end).replace(FAB_NOTE_RE, '').replace(/^\s*[.,]?\s*/, '').replace(/\s+$/, '');
      if (tail.length > 24) return null;
      name = s.slice(0, amounts[0].at);
      amtTexts = amounts.map(function (a) { return a.text; });
    } else {
      var pm = PRECUT_AMOUNT_RE.exec(s);
      if (pm) {
        name = s.slice(0, pm.index);
        amtTexts = [pm[0].replace(/\s+/g, ' ')];
      } else if (/\((?:included|suggested|optional)\)\s*$/i.test(s)) {
        name = s.replace(/\([^)]*\)\s*$/, '');
      } else {
        return null;
      }
    }
    name = name.replace(/[\s:\-\u2014,]+$/, '').replace(/^[\s\-\u2014:,*\u2022]+/, '').replace(/\s{2,}/g, ' ');
    if (name.length > 60) name = name.slice(0, 60).replace(/\s+\S*$/, '');
    // A column header ('YARDAGE', 'DESIGN COLOR') or a fragment ('OR', 'x') is
    // not a fabric. A shattered yardage column produces a heap of these, and no
    // rows plus an honest warning beats twenty rows all called "Yardage".
    if (!/[A-Za-z]{3}/.test(name) || FAB_NAME_BAD.test(name)) return null;
    return { name: name, amounts: amtTexts, note: note };
  }

  var ZIP_NAME_RE = /^\(([A-Z])\)\s+([A-Za-z].{2,58})$/;
  var ZIP_ID_RE = /^[A-Z0-9]{2,}[.\-][A-Z0-9.\-]*\**$/;
  // An amount on its own, or after its item id ('PWCG002.BLUEBIRD 1 5/8 yards (1.49m)').
  var ZIP_ROW_RE = /^(?:([A-Z0-9]{2,}[.\-][A-Z0-9.\-]*?)\**\s+)?((?:\d{1,2}(?:\s+\d\/\d{1,2})?|\d\/\d{1,2})\s*(?:yards?|yds?\.?|m)\b\s*(?:\(\s*\d+(?:\.\d+)?\s*m\s*\))?)$/i;

  /**
   * A requirements table whose columns came out one after another: the
   * lettered names ('(A) Blue Magic Panel' …), then the item ids, then the
   * yardage column ('2/3 yard (0.61m)' …). FreeSpirit prints its table this
   * way and the rows were all lost (sewing-audit). Zipped back together in
   * order, and only when there are at least as many amounts as names; the
   * extra amounts at the end are the backing, paired with its printed widths.
   */
  function zipFabricColumns(lines, kinds, heads) {
    var start = -1;
    for (var i = 0; i < lines.length; i++) {
      if (kinds[i] === 'head' && headingKind(heads[i] || '') === 'fabric') { start = i; break; }
    }
    if (start < 0) return [];
    var page = lines[start].page;
    var names = [], ids = [], amounts = [], widths = [], colors = [], colorWant = 0;
    for (var j = start + 1; j < lines.length; j++) {
      if (lines[j].pageMark) { if (names.length) break; continue; }
      if (typeof page === 'number' && lines[j].page !== page) break;
      var t = lines[j].text;
      if (!t) continue;
      // The COLOR column printed as its own run of names.length lines.
      if (colorWant > 0) {
        if (/\d/.test(t) || t.length > 30) colorWant = 0;
        else { colors.push(t); colorWant--; continue; }
      }
      if (/^colou?r$/i.test(t) && names.length) { colorWant = names.length; continue; }
      var nm = ZIP_NAME_RE.exec(t);
      if (nm && !amountsIn(t).length) { names.push({ letter: nm[1], name: nm[2] }); continue; }
      if (ZIP_ID_RE.test(t)) { ids.push(t.replace(/\*+$/, '')); continue; }
      var rm = ZIP_ROW_RE.exec(t);
      if (rm) { if (rm[1]) ids.push(rm[1]); amounts.push(rm[2]); continue; }
      var wm = /^(\d{2,3})"\s*(?:\(\s*\d+(?:\.\d+)?\s*m\s*\))?\s*wide$/i.exec(t);
      if (wm) widths.push({ width: wm[1] + '"', name: (lines[j + 1] && lines[j + 1].text) || '' });
    }
    if (names.length < 3 || amounts.length < names.length) return [];
    var out = [];
    for (var k = 0; k < names.length; k++) {
      var nmTxt = 'Fabric ' + names[k].letter + ' — ' + names[k].name +
        (colors.length === names.length ? ' ' + colors[k] : '') +
        (ids.length >= names.length ? ' (' + ids[k] + ')' : '');
      out.push({ name: nmTxt, width: '', amounts: [amounts[k]], grouped: false,
        rawAmounts: [amounts[k]], note: '', line: names[k].name + ' ' + amounts[k] });
    }
    var extra = amounts.slice(names.length);
    if (extra.length && extra.length === widths.length) {
      for (var b = 0; b < extra.length; b++) {
        var bn = widths[b].name && !amountsIn(widths[b].name).length && widths[b].name.length <= 40
          ? 'Backing — ' + widths[b].name : 'Backing';
        out.push({ name: bn + (extra.length > 1 ? ' (option ' + (b + 1) + ')' : ''), width: widths[b].width,
          amounts: [extra[b]], grouped: false, rawAmounts: [extra[b]], note: '', line: bn + ' ' + extra[b] });
      }
    }
    return out;
  }

  // A garment x unit x size-group grid, now that PdfText reads it row by row
  // (Peppermint Samford p5, Wave F):
  //   TOP SHORTS PANTS
  //   METERS YARDS METERS YARDS METERS YARDS
  //   140CM 1.5 1.65 1.5 1.9 2.6 2.85
  //   SIZES A-H                       <- the group label sits mid-group
  //   113CM 1.6 1.75 1.8 2 3 3.3
  //   140CM 1.7 1.9 2.1 2.3 3 3.3
  //   SIZES I-P
  //   113CM 2 2.2 2.1 2.3 3.7 4
  // One row per garment and bolt width, one amount per size group.
  var GRID_UNIT = { meters: 'm', metres: 'm', meter: 'm', metre: 'm', yards: 'yd', yard: 'yd', yds: 'yd', yd: 'yd' };
  var GRID_ROW_RE = /^(\d{2,3})\s*(cm|"|in\b|inch(?:es)?)\s+(\d[\d. ]*)$/i;
  var GRID_GROUP_RE = /^sizes?\s+([A-Z0-9]{1,4}\s*[-–—]\s*[A-Z0-9]{1,4})$/i;

  function gridFabric(input, labels) {
    var lines = toLines(input);
    for (var i = 0; i + 1 < lines.length; i++) {
      var head = str(lines[i].text, '');
      if (!/^[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){1,5}$/.test(head)) continue;
      var cols = head.split(/\s+/);
      var colUnits = false;
      for (var c0 = 0; c0 < cols.length; c0++) if (GRID_UNIT[cols[c0].toLowerCase()]) colUnits = true;
      if (colUnits) continue;
      var j = i + 1;
      while (j < lines.length && !lines[j].text && !lines[j].pageMark) j++;
      if (j >= lines.length || lines[j].pageMark) continue;
      var units = lines[j].text.toLowerCase().split(/\s+/);
      var unitsOk = true;
      for (var u = 0; u < units.length; u++) if (!GRID_UNIT[units[u]]) unitsOk = false;
      var per = units.length / cols.length;
      if (!unitsOk || (per !== 1 && per !== 2)) continue;
      var rows = [], groups = [];
      for (var r = j + 1; r < lines.length; r++) {
        if (lines[r].pageMark) break;
        var t = lines[r].text;
        if (!t) { if (rows.length) break; continue; }
        var gm = GRID_GROUP_RE.exec(t);
        if (gm) { groups.push(gm[1].replace(/\s+/g, '').replace(/[–—]/, '-').toUpperCase()); continue; }
        var rm = GRID_ROW_RE.exec(t);
        if (!rm) break;
        var nums = rm[3].replace(/^\s+|\s+$/g, '').split(/\s+/);
        var numsOk = nums.length === units.length;
        for (var q = 0; q < nums.length; q++) if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(nums[q])) numsOk = false;
        if (!numsOk) break;
        rows.push({ width: rm[1] + (rm[2] === '"' ? '"' : ' ' + rm[2].toLowerCase().replace(/^inch(?:es)?$/, 'in')), nums: nums });
      }
      if (rows.length < 2) continue;
      // The widths repeat once per size group.
      var W = 0, seenW = {};
      for (var w0 = 0; w0 < rows.length; w0++) { if (seenW[rows[w0].width]) break; seenW[rows[w0].width] = 1; W++; }
      if (!W || rows.length % W) continue;
      var nG = rows.length / W;
      var gLabels = groups.length === nG ? groups : [];
      var gIdx = gLabels.length ? sizeGroups(gLabels.join(' '), labels) : null;
      var out = [];
      for (var c = 0; c < cols.length; c++) {
        for (var w = 0; w < W; w++) {
          var raw = [];
          for (var g = 0; g < nG; g++) {
            var row = rows[g * W + w];
            raw.push(per === 2
              ? row.nums[2 * c] + ' ' + GRID_UNIT[units[2 * c]] + ' / ' + row.nums[2 * c + 1] + ' ' + GRID_UNIT[units[2 * c + 1]]
              : row.nums[c] + ' ' + GRID_UNIT[units[c]]);
          }
          var mapped = gIdx ? expandAmounts(raw, labels, gIdx, false) : { amounts: [], grouped: false };
          var name = titleCase(cols[c]);
          var fab = {
            name: name,
            width: rows[w].width,
            amounts: mapped.amounts.length ? mapped.amounts : raw.slice(),
            grouped: nG > 1,
            rawAmounts: raw,
            note: '',
            line: name + ' · ' + rows[w].width + ' — ' + raw.map(function (a, x) {
              return (gLabels[x] ? 'sizes ' + gLabels[x] + ' ' : '') + a;
            }).join(' · ')
          };
          if (gLabels.length) fab.groupLabels = gLabels.slice();
          out.push(fab);
        }
      }
      return out.slice(0, 40);
    }
    return [];
  }

  /** parseFabric(lines, labels) -> FabricRow[] */
  function parseFabric(input, labels) {
    var lines = toLines(input);
    var out = [];
    var lastName = '';
    var groups = null;
    var groupNext = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.text;
      if (!t || ln.pageMark) continue;
      // A line can carry more than one width: 'Wide Fabric: 150cm / 60"
      // Narrow Fabric: 115cm / 45"'. Each becomes its own row.
      var found = widthsIn(t);

      if (!found.length) {
        // The size-group header comes first: it is what maps two yardage columns
        // onto five sizes, and it reads like a heading.
        var hdr = sizeGroups(t, labels);
        if (hdr) { groups = hdr; continue; }
        // 'Fabric A OMH-33447 F8' is Title Case with no full stop, so the heading
        // test claims it — but it is the row a quilter shops from, so a row that
        // parses as a requirement is a row, not a heading.
        if (isHeading(t) && !plainFabricRow(t)) {
          lastName = prettyHeading(headingText(t));
          // 'BINDING FABRIC' / 'BACKING FABRIC' over one row each (AGF): the
          // row under it is 'Fus-P-1205 5 1/2 yds', which on its own reads as
          // a twelfth fabric instead of the backing (sewing-audit).
          var gm = /^(binding|backing|batting)\b/i.exec(headingText(t));
          groupNext = gm ? titleCase(gm[1].toLowerCase()) : '';
          continue;
        }
        // Quilt yardage never names a bolt width — WOF is assumed — so a row is
        // just a name and an amount: 'Fabric A Fus-P-1208 3/4 yd.',
        // 'Backing 5 1/2 yds', 'Fabric B 1 Fat Quarter, lining' (05 #4).
        var plain = plainFabricRow(t);
        if (plain) {
          var mappedPlain = expandAmounts(plain.amounts, labels, groups, ALL_SIZES_RE.test(t));
          var pName = plain.name || lastName || 'Fabric';
          if (groupNext && pName.toLowerCase().indexOf(groupNext.toLowerCase()) < 0) pName = groupNext + ' — ' + pName;
          groupNext = '';
          // '(Included)': the binding comes out of a fabric already listed.
          var pAmts = plain.amounts.length ? plain.amounts.slice()
            : (/^included$/i.test(plain.note) ? ['included'] : []);
          out.push({
            name: pName,
            width: '',
            amounts: mappedPlain.amounts.length ? mappedPlain.amounts : pAmts,
            grouped: mappedPlain.grouped,
            rawAmounts: pAmts,
            note: plain.note,
            line: t
          });
          if (out.length >= 40) break;
          continue;
        }
        if (t.length <= 40 && /[a-z]/i.test(t) && !AMOUNT_RE.test(t)) lastName = t.replace(/[:\-—]\s*$/, '');
        AMOUNT_RE.lastIndex = 0;
        continue;
      }

      var tail = t.slice(found[found.length - 1].end);
      var amounts = amountTexts(tail);
      var consumedNext = false;
      if (!amounts.length && i + 1 < lines.length && lines[i + 1].text) {
        // The amounts often sit on the line under the widths.
        var nxt = amountTexts(lines[i + 1].text);
        if (nxt.length && !widthsIn(lines[i + 1].text).length) { amounts = nxt; consumedNext = true; }
      }
      var fullLine = consumedNext ? (t + ' ' + lines[i + 1].text) : t;
      var allSizes = ALL_SIZES_RE.test(fullLine);
      var raw = amounts.slice();
      // Several widths on one line share the amounts between them, in order.
      var per = found.length > 1
        ? (amounts.length % found.length === 0 ? amounts.length / found.length : 0)
        : amounts.length;

      for (var f = 0; f < found.length; f++) {
        var from = f === 0 ? 0 : found[f - 1].end;
        var name = t.slice(from, found[f].at).replace(/[:\-—,]\s*$/, '').replace(/^[\s\-—:,\/]+/, '').replace(/^\s+|\s+$/g, '');
        // 'MAIN - m / yd Wide Fabric' prints the units legend inside the name.
        name = name.replace(UNIT_LEGEND_RE, ' ').replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
        if (!name) name = lastName || 'Fabric';
        // The block's own title is not the name of a fabric.
        if (FAB_NAME_BAD.test(name)) name = 'Fabric';
        var mine = found.length > 1 ? amounts.slice(f * per, (f + 1) * per) : amounts;
        var mapped = expandAmounts(mine, labels, groups, allSizes);
        out.push({
          name: name,
          width: found[f].text,
          amounts: mapped.amounts,
          grouped: mapped.grouped,
          rawAmounts: raw,
          note: '',
          line: fullLine
        });
        if (out.length >= 40) break;
      }
      if (consumedNext) i++;
      if (out.length >= 40) break;
    }
    // A bolt width with no amount anywhere near it ('140CM' / 'SIZES A-H' in
    // a grid whose numbers came out elsewhere, Peppermint Samford) tells the
    // shopper nothing; an honest "not found" beats four empty rows.
    out = out.filter(function (r) { return !(r.width && !r.amounts.length && !r.rawAmounts.length); });
    // 'Outer swim  Metres 0.9m 1m …' over '   fabric  Yards 1 yard 1 1/8 yard …'
    // (Peppermint bathers): ONE fabric printed in two units on two lines, with
    // its name split across them. Put back together as 'Outer swim fabric'
    // with '0.9 m / 1 yard' per size (sewing-audit).
    var merged = [];
    for (var mi = 0; mi < out.length; mi++) {
      var A = out[mi], B = out[mi + 1];
      if (B && !A.width && !B.width && /\s(?:metres|meters)$/i.test(A.name) && /(?:^|\s)(?:yards|yds)$/i.test(B.name) &&
          A.amounts.length === B.amounts.length && A.rawAmounts.length === B.rawAmounts.length) {
        var nm2 = (A.name.replace(/\s+(?:metres|meters)$/i, '') + ' ' + B.name.replace(/\s*(?:yards|yds)$/i, ''))
          .replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
        merged.push({
          name: nm2.charAt(0).toUpperCase() + nm2.slice(1),
          width: '',
          amounts: A.amounts.map(function (a, x) { return a + ' / ' + B.amounts[x]; }),
          grouped: A.grouped,
          rawAmounts: A.rawAmounts.map(function (a, x) { return a + ' / ' + B.rawAmounts[x]; }),
          note: A.note || B.note,
          line: A.line + ' ' + B.line
        });
        mi++;
        continue;
      }
      merged.push(A);
    }
    return merged;
  }

  /**
   * Sewing.fabricForSize(rows, labels, chosen) -> [{ name, width, amount }]
   * The one line a sewist standing in the fabric shop actually wants.
   */
  function fabricForSize(rows, labels, chosen) {
    var out = [];
    if (!isArr(rows) || !isArr(labels) || !str(chosen, '')) return out;
    var at = -1;
    for (var i = 0; i < labels.length; i++) {
      if (str(labels[i], '') === str(chosen, '')) { at = i; break; }
    }
    if (at < 0) return out;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!isObj(row) || !isArr(row.amounts) || row.amounts.length !== labels.length) continue;
      var amount = str(row.amounts[at], '');
      if (!amount) continue;
      out.push({ name: str(row.name, 'Fabric') || 'Fabric', width: str(row.width, ''), amount: amount });
    }
    return out;
  }

  // =====================================================================
  // 9. Meta, kind detection, quilt unit counters
  // =====================================================================

  // Quilting evidence in two tiers. 'binding' and 'strips' alone described an
  // apron with bias binding and a bias-tape loop, which came out as a quilt, so
  // at least one STRONG sign — something only a quilt says — is now required.
  var QUILT_STRONG = [/\bWOF\b/, /\bwidth of (?:the )?fabric\b/i, /\bfat (?:quarters?|eighths?)\b/i,
    /\bsub-?\s?cut\b/i, /\bsashing\b/i, /\bquilt(?:s|ing|ed)?\b/i, /\bhalf[\s-]square triangles?\b/i,
    /\bflying geese\b/i, /\bjelly roll\b/i, /\bbatting\b/i, /\bwadding\b/i];
  var QUILT_SIGNS = [/\bWOF\b/, /\bwidth of fabric\b/i, /\bstrips?\b/i, /\bbinding\b/i, /\bbacking\b/i, /\bbatting\b/i, /\bfat quarters?\b/i, /\bblocks?\b/i, /\bsashing\b/i];
  var BAG_SIGNS = [/\blining\b/i, /\binterfacing\b/i, /\bd-?rings?\b/i, /\bswivel\b/i, /\bmagnetic snap\b/i, /\bzips?\b|\bzippers?\b/i, /\bstraps?\b/i, /\bgussets?\b/i, /\bwebbing\b/i];
  var GARMENT_SIGNS = [/\bbodice\b/i, /\bsleeves?\b/i, /\bhem(?:s|ming|line)?\b/i, /\bdarts?\b/i, /\bfacings?\b/i, /\bwaistband\b/i, /\bcollars?\b/i, /\bneckline\b/i, /\barmholes?\b/i, /\bcuffs?\b/i];

  function countSigns(text, list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].test(text)) n++;
    return n;
  }

  // A printed pattern SHEET (A0 or tiled A4) is not a booklet: it carries piece
  // labels, registration marks and a test square, and nothing to do. Parsed as
  // instructions it produces "steps" made of hashtags (05: the apron A0 sheet).
  var SHEET_SIGNS = [
    [/\bplace\s+on\s+(?:the\s+)?fold\b/i, 2],
    [/\bgrain\s?line\b/i, 2],
    [/\blengthen\s*(?:\/|or|and)?\s*shorten\b/i, 2],
    [/\btest\s+square\b/i, 2],
    [/\bthis\s+is\s+a\s+fold\s+mark\b/i, 2],
    [/\bpage\s+\d{1,2}[a-h]\b/i, 2],                 // tiled sheets: 'Page 1A'
    [/\b(?:cut|align|match)\s+(?:on|along)\s+(?:the\s+)?(?:solid|dashed|black)\s+lines?\b/i, 1],
    [/\bregistration\s+marks?\b/i, 2],
    [/\bprint\s+at\s+(?:"?actual size"?|100%)\b/i, 1],
    [/\bseam\s+allowance\s+included\b/i, 1]
  ];
  var SHEET_PROSE_RE = /\b(?:right sides? together|press|topstitch|baste|understitch|backstitch|stay ?stitch)\b/i;

  /** True when one short line is stamped over the document three times or more. */
  function repeatedStamp(text) {
    var lines = str(text, '').split('\n');
    var counts = {};
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/^\s+|\s+$/g, '');
      if (t.length < 3 || t.length > 30 || !/[A-Za-z]{3}/.test(t)) continue;
      if (PAGE_RE.test(t)) continue;
      counts[t] = (counts[t] || 0) + 1;
      if (counts[t] >= 3) return true;
    }
    return false;
  }

  /**
   * detectSheet(text, steps) -> boolean
   * Sheet evidence, no construction prose and nothing numbered to do.
   */
  function detectSheet(text, stepCount) {
    var t = str(text, '');
    if (!t) return false;
    if (stepCount) return false;
    var score = 0;
    for (var i = 0; i < SHEET_SIGNS.length; i++) if (SHEET_SIGNS[i][0].test(t)) score += SHEET_SIGNS[i][1];
    // Every piece on a sheet is stamped with the same label — the pattern's
    // hashtag, the designer's name, the size run — so the same short line comes
    // back three or more times. A booklet repeats a footer at most once a page.
    if (repeatedStamp(t)) score += 2;
    if (score < 3) return false;
    // A booklet that happens to explain its fold marks still talks like a
    // booklet; a sheet has no sewing prose on it at all.
    var prose = t.match(SHEET_PROSE_RE);
    return !prose;
  }

  /** detectKind(text, hasSizeChart) -> 'garment'|'bag'|'quilt'|'unknown' */
  function detectKind(text, hasSizeChart) {
    var t = str(text, '');
    if (!t) return 'unknown';
    var strong = countSigns(t, QUILT_STRONG);
    var q = strong ? countSigns(t, QUILT_SIGNS) : 0;
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
  // 'Make a total of 4 Unit 2a', 'make (1) each Blocks 2b-2d', 'Block 3 - Make 4'
  // — the named-unit form every pieced-quilt booklet uses under its diagrams.
  // (sewing-audit) 'make 4Unit 7b' is printed with no space, and 'Make a total
  // of 4 Inner Borders' counts a pieced border like a unit (FreeSpirit Harmony).
  var UNIT_MAKE_RE = /\bmake\s+(?:a\s+total\s+of\s+)?\(?(\d{1,4})\)?\s*(?:each\s+)?((?:unit|block|inner\s+border)s?\s*[0-9a-z]{0,3})/gi;
  var UNIT_NAMED_RE = /\b((?:unit|block)\s*[0-9]{1,2}[a-z]?)\s*[-–—]?\s*make\s+\(?(\d{1,4})\)?/gi;

  /** parseUnits(text) -> [{ id, name, target, done }] - quilt block counters. */
  function parseUnits(text) {
    var t = normalizeText(str(text, ''));
    var out = [];
    var byName = {};

    function add(name, target) {
      if (!target || target < 4 || target > 9999) return;
      name = titleCase(str(name, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''));
      if (!name || name.length < 3) return;
      var k = key(name);
      if (byName[k]) {
        if (target > byName[k].target) byName[k].target = target;
        return;
      }
      if (out.length >= 24) return;   // the data model keeps 24 (Harmony needs 17)
      var row = { id: uid('u'), name: name, target: target, done: 0 };
      byName[k] = row;
      out.push(row);
    }

    var m;
    UNIT_RE.lastIndex = 0;
    while ((m = UNIT_RE.exec(t))) {
      if (parseInt(m[1], 10) >= 4) add(m[2], parseInt(m[1], 10));
    }
    UNIT_RE.lastIndex = 0;
    UNIT_MAKE_RE.lastIndex = 0;
    while ((m = UNIT_MAKE_RE.exec(t))) add(m[2], parseInt(m[1], 10));
    UNIT_MAKE_RE.lastIndex = 0;
    UNIT_NAMED_RE.lastIndex = 0;
    while ((m = UNIT_NAMED_RE.exec(t))) add(m[1], parseInt(m[2], 10));
    UNIT_NAMED_RE.lastIndex = 0;
    return out;
  }

  // '(c)' only counts before a year: '(C) Little Somewhere Plum' is fabric C
  // in FreeSpirit's requirements table, not a copyright line (sewing-audit).
  var COPYRIGHT_RE = /(?:©|\(c\)(?=\s*\d{4})|copyright)\s*(?:\d{4}\s*)?([A-Z][^\n©|]{2,40}?)\s*(?:\d{4})?\s*$/gim;
  var VERSION_RE = /\b(?:v(?:ersion)?\s*\.?\s*)(\d+(?:\.\d+)?)\b/i;
  var VIEW_RE = /\bview\s+([A-Z])\b/g;
  var NAME_SKIP_RE = /^(?:instructions?|sewing pattern|pattern|contents|page \d+|https?:|www\.|©|copyright|all rights reserved)/i;
  var NAME_HINT_RE = /\b(top|shirt|dress|sundress|tank|tee|jacket|coat|bag|handbag|purse|clutch|tote|pouch|quilt|skirt|pants|joggers?|trousers|shorts|blouse|jumpsuit|robe|hoodie|sweater|cardigan|vest|apron|backpack|sling|wallet|cushion|pillow|bathers|swimsuit|bikini)\b/i;
  // A cover line that is not a name: the test square, the legend, a tile
  // label, a measurement ('10 centimeters').
  // ('QUILT DESIGNED BY JESSICA SWIFT', 'Harmony by Carolyn Gavin' are credits.)
  var NAME_JUNK_RE = /^(?:test\s*square|this is\b|page\s*\d+\s*[a-z]?$|\d|featuring\b|for\s|collection\b|technique\b|skill\b)|free\s*pattern|\bdesigned\s+by\b|\s+by\s+[A-Za-z]|\s+by$/i;
  var TITLED_NAME_RE = /^(?:(?:instructions?|pattern)\s*(?:&|and)\s*)?(?:instructions?|pattern)\s*[:\-–—]?\s+([A-Z].{2,47})$/i;

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
    // (sewing-audit) Swoon prints the real name only as 'Instructions &
    // Pattern Mabel Vintage Handbag' on page 2; the cover says 'swoon'.
    var bestName = '', bestScore = 0, lowFull = fullText.toLowerCase();
    for (var j = 0; j < lines.length && j < 120 && !bestName; j++) {
      if (lines[j].pageMark || !lines[j].text) continue;
      if (lines[j].page !== null && lines[j].page > 3) break;
      var tm = TITLED_NAME_RE.exec(lines[j].text);
      if (tm && NAME_HINT_RE.test(tm[1])) bestName = tm[1];
    }
    // Page 1 first; a tiled pattern sheet prints its name on a later tile
    // (Tiana's joggers: page 1 is only the test square).
    for (var pass = 1; pass <= 2 && !bestName; pass++) {
      var lastPage = pass === 1 ? 1 : 3;
      for (var i = 0; i < lines.length && i < (pass === 1 ? 40 : 250); i++) {
        var t = lines[i].text;
        if (!t || lines[i].pageMark) continue;
        if (lines[i].page !== null && lines[i].page > lastPage) break;
        if (t.length < 3 || t.length > 48) continue;
        // a label line ('Finished Block Sizes:', 'Technique: Pieced') is not a name
        if (NAME_SKIP_RE.test(t) || NAME_JUNK_RE.test(t) || /:/.test(t)) continue;
        // 'f r e e p a t t e r n', 'F R E EF R E E P A T T E R N' (AGF covers)
        if (/(?:^|\s)(?:\S\s){3,}\S(?:\s|$)/.test(t)) continue;
        if (headingKind(headingText(t))) continue;
        if (/[.!?]$/.test(t)) continue;
        // Past the cover only a line that names a garment or item will do.
        if (pass === 2 && !NAME_HINT_RE.test(t)) continue;
        var score = 0;
        if (!/[a-z]/.test(t)) score += 2;
        else if (/^[A-Z]/.test(t)) score += 1;
        if (NAME_HINT_RE.test(t)) score += 3;
        if (t.split(/\s+/).length <= 5) score += 1;
        if (i < 12) score += 1;
        // The real name is printed more than once ('REQUIREMENTS TRIPLE T
        // TOTE' and 'Triple T Tote'); a strapline like 'Standard Piecing Bag'
        // is printed once.
        var low = t.toLowerCase(), at = lowFull.indexOf(low);
        if (at >= 0 && lowFull.indexOf(low, at + low.length) >= 0) score += 2;
        if (score >= 3 && score > bestScore) { bestScore = score; bestName = t; }
      }
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
      variations: [],
      seamAllowance: null,
      kind: 'unknown',
      pages: 0,
      sourceText: '',
      warnings: []
    };
  }

  var STRONG_CUT_RE = /^(?:sub-?\s?cut\b|\(?\d{1,3}\)?\s+strips?\b|from\s+.{2,40}?[,:]\s*cut\b|cut\s*[x×]\s*\d)/i;

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

    // --- steps --------------------------------------------------------------
    var firstStepIndex = -1;
    try {
      var steps = parseSteps(lines, { blocks: info, columns: opts.columns, fallback: !!opts.fallbackSteps });
      res.steps = Array.prototype.slice.call(steps);
      res.variations = isArr(steps.variations) ? steps.variations.slice(0, 200) : [];
      firstStepIndex = typeof steps.firstIndex === 'number' ? steps.firstIndex : -1;
      if (steps.warnings) steps.warnings.forEach(function (w) { pushUnique(res.warnings, w); });
    } catch (e5) { pushUnique(res.warnings, 'The steps could not be read.'); }

    // --- kind (after the steps: a pattern SHEET has none) -------------------
    try {
      res.kind = (opts.craftHint && /^(garment|bag|quilt|sheet)$/.test(opts.craftHint))
        ? opts.craftHint
        : (detectSheet(norm, res.steps.length) ? 'sheet' : detectKind(norm, !!res.sizes));
    } catch (e4) { res.kind = 'unknown'; }
    if (res.kind === 'sheet') {
      // A printed pattern sheet: piece labels and registration marks. Keep the
      // cutting labels, drop everything that pretends it is a booklet.
      res.steps = [];
      res.variations = [];
      pushUnique(res.warnings, 'This looks like a printed pattern sheet, not the instructions — the pieces were read, there are no steps.');
    }

    // --- cutting list -------------------------------------------------------
    try {
      var cutLines = [];
      var pushedAt = -1;
      function pushCut(at, wide) {
        // The piece's name is often printed as a label on the line above the cut
        // ('Main Panel' / 'Cut 2 Lining Fabric'), so carry that line along.
        // A layered size-per-layer sheet glues its overprinted size labels onto
        // the piece name ('FRONTSIZE 12MSIZE 18M', 'cut 2BACKSIZE 6SIZE 3T',
        // Tiana's joggers): they are stripped, and a line that was nothing but
        // size labels is stepped over to find the name (sewing-audit).
        var own = sheetClean(lines[at].text);
        if (wide) {
          var near = sheetLabelNear(at);
          if (near) cutLines.push(near);
        } else {
          var up = at - 1;
          if (up >= 0 && lines[up].text && !sheetClean(lines[up].text) && SIZE_RUN_TEST.test(lines[up].text)) up--;
          if (up >= 0 && pushedAt < up && lines[up].text && !lines[up].pageMark) {
            var lab = sheetClean(lines[up].text);
            if (lab && labelCandidate(lab)) cutLines.push(lab === lines[up].text ? lines[up] : { text: lab, page: lines[up].page });
          }
        }
        cutLines.push(own === lines[at].text ? lines[at] : { text: own, page: lines[at].page });
        pushedAt = at;
      }
      /**
       * The piece label for a cut line on a pattern SHEET. Rotated labels come
       * out of the PDF above or below their 'Cut N' lines, with the brand
       * stamp, '®' and 'FOLD' in between (Swoon Mabel p11-13): the nearest
       * label above wins, a cut line above means "same piece as that one", and
       * only then is the label looked for below (sewing-audit).
       */
      function sheetLabelNear(at) {
        function pick(u) {
          var tx = lines[u].text;
          if (/^cut\s+size\b/i.test(tx)) return null;          // a dimension, not a count
          if (/^cut\b/i.test(tx) || STRONG_CUT_RE.test(tx)) return 'stop';
          var cl = sheetClean(tx);
          // an all-lowercase line is a brand stamp ('swoon', 'vintage handbag')
          if (!cl || SIZE_RUN_TEST.test(tx) || SHEET_JUNK_RE.test(cl) || /^cut\s+size\b/i.test(cl) ||
              /^[a-z][a-z ]*$/.test(cl)) return null;
          var lb = labelCandidate(cl);
          if (!lb || SHEET_JUNK_RE.test(lb) || /\b(?:placement|test square|printed|correct size|this is)\b/i.test(lb)) return null;
          return { text: lb, page: lines[u].page };
        }
        for (var u = at - 1, n1 = 0; u >= 0 && n1 < 4; u--) {
          if (lines[u].pageMark) break;
          if (!lines[u].text) continue;
          n1++;
          var r1 = pick(u);
          if (r1 === 'stop') return null;
          if (r1) return r1;
        }
        for (var d = at + 1, n2 = 0; d < lines.length && n2 < 6; d++) {
          if (lines[d].pageMark) break;
          if (!lines[d].text) continue;
          n2++;
          var r2 = pick(d);
          if (r2 === 'stop') return null;
          if (r2) return r2;
        }
        return null;
      }
      for (var c = 0; c < lines.length; c++) {
        if (kinds[c] === 'cut') { cutLines.push(lines[c]); pushedAt = c; continue; }
        if (kinds[c] === 'head' && headingKind(heads[c]) === 'cut') { cutLines.push(lines[c]); pushedAt = c; continue; }
        // A group label inside the cutting list ('Bikini Top' / 'Bikini
        // Briefs') tells two 'Cut x 1 front on the fold' rows apart.
        if (kinds[c] === 'head' && info.owners && info.owners[c] === 'cut' && !headingKind(heads[c])) {
          cutLines.push(lines[c]); pushedAt = c; continue;
        }
        var ct = lines[c].text;
        if (!ct) continue;
        if (STRONG_CUT_RE.test(ct)) { pushCut(c); continue; }
        if (firstStepIndex >= 0 && c > firstStepIndex) {
          // The pattern-sheet pages bound in after the instructions still carry
          // the cutting information: a short, count-led line that is not a
          // sentence ('Cut 2 Lining Fabric') is a piece, wherever it sits.
          if (/^cut\s*\(?\s*\d/i.test(ct) && ct.length <= 45 && !/[.!?]$/.test(ct)) pushCut(c, true);
          continue;
        }
        if (kinds[c] === 'none' && /^cut\b/i.test(ct)) pushCut(c, res.kind === 'sheet');
      }
      res.cuttingList = Array.prototype.slice.call(parseCutting(cutLines));
      if (!res.cuttingList.length) pushUnique(res.warnings, 'No cutting list found — add the pieces yourself.');
    } catch (e6) { pushUnique(res.warnings, 'The cutting list could not be read.'); }

    // --- notions ------------------------------------------------------------
    try {
      var blockLines = [], looseLines = [];
      for (var n = 0; n < lines.length; n++) {
        if (kinds[n] === 'notions') blockLines.push(lines[n]);
        // A free pattern's 'REQUIREMENTS' block mixes yardage with the zip and
        // the interfacing, so the fabric block is scanned for notions too — with
        // the vocabulary required, so a yardage row does not become a notion.
        else if (kinds[n] === 'fabric') looseLines.push(lines[n]);
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
      var owners = info.owners || [];
      for (var f = 0; f < lines.length; f++) {
        // A group header inside the table ('SIZE', 'XS-L 1X-3X 4X-5X 6X-9X') is
        // tagged as a heading but belongs to the block — and it is what maps the
        // yardage columns onto the sizes.
        if (kinds[f] === 'fabric' ||
            (kinds[f] === 'head' && (headingKind(heads[f]) === 'fabric' || owners[f] === 'fabric'))) {
          fabLines.push(lines[f]);
        }
      }
      res.fabric = parseFabric(fabLines, res.sizes ? res.sizes.labels : null);
      // A column-split table read back together beats the one stray row the
      // line reader salvaged from it (FreeSpirit: only the 44" backing line).
      var zipped = zipFabricColumns(lines, kinds, heads);
      if (zipped.length >= 3 && zipped.length > res.fabric.length) res.fabric = zipped;
      // A garment x unit x size-group grid read row by row (Samford, Wave F):
      // its rows are the whole table, so they replace whatever the line
      // reader salvaged from the same block.
      var grid = gridFabric(lines, res.sizes ? res.sizes.labels : null);
      if (grid.length >= 2) res.fabric = grid;
      // '1/2 yard 44" wide quilting weight exterior fabric' printed in the
      // materials list is a fabric requirement, not a notion (Swoon Mabel).
      var keptNotions = [];
      for (var fn = 0; fn < res.notions.length; fn++) {
        var nt = res.notions[fn].text;
        var nAmt = amountsIn(nt), nW = widthsIn(nt);
        if (/\bfabrics?\b/i.test(nt) && nAmt.length && FAB_UNIT_RE.test(nAmt[0].text) && res.fabric.length < 40) {
          // Whatever is left once the amount and the bolt width are taken out:
          // 'quilting weight exterior fabric', 'fabric' (Peppermint apron).
          var chars = nt.split('');
          nAmt.concat(nW).forEach(function (r) { for (var ci = r.at; ci < r.end; ci++) chars[ci] = ' '; });
          var fName = chars.join('');
          fName = fName.replace(/\b(?:wide|width|of|minimum)\b/gi, ' ').replace(/\(\s*\)/g, ' ')
            .replace(/\s{2,}/g, ' ').replace(/^[\s,:\-—]+|[\s,:\-—]+$/g, '');
          res.fabric.push({ name: fName ? fName.charAt(0).toUpperCase() + fName.slice(1) : 'Fabric',
            width: nW.length ? nW[0].text : '', amounts: [nAmt[0].text], grouped: false,
            rawAmounts: [nAmt[0].text], note: '', line: nt });
          continue;
        }
        keptNotions.push(res.notions[fn]);
      }
      res.notions = keptNotions;
    } catch (e9) { pushUnique(res.warnings, 'The fabric requirements could not be read.'); }

    // --- quilt unit counters ------------------------------------------------
    try {
      if (res.kind === 'quilt') res.units = parseUnits(norm);
    } catch (e10) { /* counters are a bonus; never warn */ }

    // --- meta ---------------------------------------------------------------
    try { res.meta = parseMeta(lines, norm); } catch (e11) { pushUnique(res.warnings, 'The pattern name could not be read.'); }

    // --- warnings this kind of pattern should never see (05 #17) ------------
    // A quilt has no size chart and often no notions block; a pattern sheet has
    // neither, no steps and no seam allowance. Warning about them buries the one
    // thing that IS missing.
    if (res.kind === 'quilt' || res.kind === 'sheet') {
      res.warnings = res.warnings.filter(function (w) {
        return !/^No size chart found/.test(w) && !/^No notions list found/.test(w);
      });
    }
    if (res.kind === 'sheet') {
      res.warnings = res.warnings.filter(function (w) {
        return !/^No seam allowance found/.test(w) && !/^No numbered steps found/.test(w) &&
          !/^No cutting list found/.test(w) && !/columns may be interleaved/.test(w);
      });
    }
    if (res.kind === 'quilt' && !res.fabric.length) {
      pushUnique(res.warnings, 'No fabric requirements found — add the yardage yourself.');
    }
    // The booklet prints a fabric table the reader could not put back together
    // (Peppermint Samford's size-group grid): say so rather than stay silent.
    if (res.kind !== 'quilt' && res.kind !== 'sheet' && !res.fabric.length && /fabric\s+requirements/i.test(norm)) {
      pushUnique(res.warnings, 'The fabric requirements table could not be read — add the yardage yourself.');
    }

    if (res.warnings.length > 20) res.warnings = res.warnings.slice(0, 20);
    return res;
  }

  // =====================================================================
  // 11. craftData: normalize / toCraftData / summary / templates
  // =====================================================================

  var SOURCE_CAP = 60000;
  var STEP_SAVED_CAP = 4000;

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
          var frow = {
            name: fname || 'Fabric',
            width: str(f.width, '').slice(0, 24),
            amounts: normStrArray(f.amounts, 32, 24),
            grouped: !!f.grouped,
            rawAmounts: normStrArray(f.rawAmounts, 32, 24),
            note: str(f.note, '').slice(0, 200),
            line: fline
          };
          // The size group each raw amount belongs to ('A-H', 'I-P'), when the
          // table names its groups but the booklet has no size chart to map
          // them onto (Samford, Wave F). Kept only when it lines up.
          var fgl = normStrArray(f.groupLabels, 32, 12);
          if (fgl.length && fgl.length === frow.rawAmounts.length) frow.groupLabels = fgl;
          d.fabric.push(frow);
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
            dims: str(cc.dims, '').slice(0, 60),
            subcut: !!cc.subcut
          });
        }
      }

      if (isArr(raw.steps)) {
        for (var si = 0; si < raw.steps.length && d.steps.length < 400; si++) {
          var ss = raw.steps[si];
          if (!isObj(ss)) continue;
          // A card the sewist merged can be longer than any card the parser
          // makes (800), so the saved cap is higher (Wave F).
          var stext = str(ss.text, '').replace(/^\s+|\s+$/g, '').slice(0, STEP_SAVED_CAP);
          if (!stext) continue;
          var srow = {
            id: str(ss.id, '') || uid('s'),
            n: clampInt(ss.n, 0, 9999, d.steps.length + 1),
            section: str(ss.section, '').slice(0, 60),
            text: stext,
            done: !!ss.done,
            page: (typeof ss.page === 'number' && isFinite(ss.page)) ? clampInt(ss.page, 0, 9999, null) : null,
            imageRef: typeof ss.imageRef === 'string' && ss.imageRef ? ss.imageRef.slice(0, 120) : null,
            optional: !!ss.optional
          };
          // `src`: the imported card(s) a split or merged card came from, so a
          // re-import can put the sewist's own split back (see toCraftData).
          if (typeof ss.src === 'string' && /^[a-z0-9.+]{3,400}$/.test(ss.src)) srow.src = ss.src;
          d.steps.push(srow);
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
    // The import sheet unticks a group it found nothing for; "Just keep the
    // text" unticks them all. Only a real import clears template placeholders.
    var realImport = !opts.groups || Object.keys(groups).some(function (g) { return groups[g] !== false; });

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
      // Keyed by piece AND fabric: the Mabel bag cuts a 'Main Panel' from the
      // main fabric, the lining and the interfacing, and a re-import gave all
      // three the count of the one you had cut (Wave F).
      var hadCut = {};
      var cutKey = function (r) { return key(r.piece) + '|' + str(r.material, 'main') + '|' + key(str(r.note, '')); };
      // By name alone only when the name is unique on both sides (a row whose
      // fabric the sewist changed in the editor keeps its count).
      var byName = {}, nameCount = {}, inCount = {};
      prev.cutting.forEach(function (r) {
        if (r.cutCount > 0) hadCut[cutKey(r)] = r.cutCount;
        nameCount[key(r.piece)] = (nameCount[key(r.piece)] || 0) + 1;
        byName[key(r.piece)] = r.cutCount;
      });
      pr.cuttingList.forEach(function (r) { if (isObj(r)) inCount[key(str(r.piece, ''))] = (inCount[key(str(r.piece, ''))] || 0) + 1; });
      var cutting = [];
      for (var c = 0; c < pr.cuttingList.length && cutting.length < 300; c++) {
        var cr = pr.cuttingList[c];
        if (!isObj(cr)) continue;
        var piece = str(cr.piece, '').replace(/^\s+|\s+$/g, '').slice(0, 60);
        if (!piece) continue;
        var qty = clampInt(cr.qty, 1, 999, 1);
        var inMat = MATERIAL_SET[str(cr.material, '')] ? cr.material : 'main';
        var had = hadCut[key(piece) + '|' + inMat + '|' + key(str(cr.note, '').slice(0, 120))];
        if (had === undefined && nameCount[key(piece)] === 1 && inCount[key(piece)] === 1) had = byName[key(piece)];
        cutting.push({
          id: uid('c'),
          piece: piece,
          qty: qty,
          cutCount: clampInt(had, 0, qty, 0),
          material: inMat,
          onFold: !!cr.onFold,
          grain: str(cr.grain, '').slice(0, 40),
          note: str(cr.note, '').slice(0, 120),
          dims: str(cr.dims, '').slice(0, 60),
          subcut: !!cr.subcut
        });
      }
      out.cutting = cutting;
    } else if (realImport && isArr(pr.cuttingList) && str(pr.sourceText, '')) {
      // A real import that found no cutting list must not leave the new-project
      // template's placeholder pieces (Front / Back / Sleeve / Facing /
      // Interfacing) standing in for the pattern's: the home card read "0 of 5
      // cut" for the Peppermint apron, whose pieces are only on the pattern
      // sheet (sewing-audit). Rows the user touched or added stay.
      out.cutting = out.cutting.filter(function (r) { return !(r.cutCount === 0 && isTemplateCut(r)); });
    }
    if (realImport && isArr(pr.notions) && !pr.notions.length && str(pr.sourceText, '')) {
      out.notions = out.notions.filter(function (r) { return !(!r.have && isTemplateNotion(r)); });
    }

    // --- steps: preserve done by normalised text ----------------------------
    if (want('steps') && isArr(pr.steps) && pr.steps.length) {
      var hadStep = {};
      prev.steps.forEach(function (r) { if (r.done) hadStep[key(r.text)] = 1; });
      var steps = [];
      // The variation / care paragraphs travel with the project but sit after
      // the construction and stay flagged, so nothing is lost and nothing
      // inflates "step 11 of 15" (05 #2).
      var incoming = pr.steps.concat(isArr(pr.variations) ? pr.variations : []);
      // The sewist's own splits and merges (Wave F, 05 #1): cards carrying a
      // `src` are put back in place of the imported card(s) they came from,
      // as long as that text is unchanged — so a re-import neither undoes the
      // split nor loses the ticks on its halves.
      var bySrc = {}, srcOrder = [], srcUsed = {};
      prev.steps.forEach(function (r) {
        if (!r.src) return;
        if (!bySrc[r.src]) { bySrc[r.src] = []; srcOrder.push(r.src); }
        bySrc[r.src].push(r);
      });
      var inKeys = incoming.map(function (r) {
        return isObj(r) ? textKey(str(r.text, '').replace(/^\s+|\s+$/g, '').slice(0, STEP_TEXT_CAP + 8)) : '';
      });
      for (var s = 0; s < incoming.length && steps.length < 400; s++) {
        var sr = incoming[s];
        if (!isObj(sr)) continue;
        var replay = null;
        for (var so = 0; so < srcOrder.length && !replay; so++) {
          var parts = srcOrder[so].split('+');
          if (srcUsed[srcOrder[so]] || parts[0] !== inKeys[s]) continue;
          var whole = true;
          for (var pj = 1; pj < parts.length; pj++) if (inKeys[s + pj] !== parts[pj]) whole = false;
          if (whole) { replay = bySrc[srcOrder[so]]; srcUsed[srcOrder[so]] = 1; s += parts.length - 1; }
        }
        if (replay) {
          for (var rp = 0; rp < replay.length && steps.length < 400; rp++) {
            var rc = deepCopy(replay[rp]);
            rc.id = uid('s');
            steps.push(rc);
          }
          continue;
        }
        var text = str(sr.text, '').replace(/^\s+|\s+$/g, '').slice(0, STEP_TEXT_CAP + 8);
        if (!text) continue;
        steps.push({
          id: uid('s'),
          n: clampInt(sr.n, 0, 9999, steps.length + 1),
          section: str(sr.section, '').slice(0, 60),
          text: text,
          done: !!hadStep[key(text)],
          page: (typeof sr.page === 'number' && isFinite(sr.page)) ? clampInt(sr.page, 0, 9999, null) : null,
          imageRef: null,
          optional: !!sr.optional
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
        // Counted over the construction steps: the optional variation / care
        // extras kept after them are not "step 12 of 15" (sewing-audit).
        // In the pattern's own numbering ('step 4 of 6' for the pencil skirt,
        // whatever its cards), per numbering run (coordinator, Wave E).
        var ps = printedSteps(d.steps);
        var atIdx = Math.min(d.currentStep, d.steps.length - 1);
        var pos = ps.of[atIdx];
        if (pos) bits.push('step ' + pos.n + ' of ' + pos.runTotal);
        else if (ps.total) bits.push(printedDone(d.steps, ps) >= ps.total ? 'all ' + ps.total + ' steps done' : 'optional extras');
        else bits.push('step ' + (atIdx + 1) + ' of ' + d.steps.length);
      }
      if (d.cutting.length) {
        // Pieces, not rows: '3 of 56 cut' for a row of 56 squares (05 #3, Wave F).
        var ct = cutTotals(d);
        bits.push(ct.cut + ' of ' + ct.total + ' cut');
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

  /**
   * Sewing.printedSteps(steps) -> the pattern's OWN numbering over the cards.
   *
   * The user reads the paper alongside the phone, so the header says "Step 3
   * of 6" as printed, not "card 5 of 11". Consecutive construction cards that
   * share a printed number are one printed step: its '(continued)' cards and
   * its titled sub-paragraphs ('Centre Back Seam:' under step 4). A number
   * lower than the one before starts a new run (the bathers top 1-10, then
   * the briefs 1-5), and each run is counted on its own. Optional extras
   * (variations, care notes) are not steps. Untitled paragraph steps carry
   * their card order as their number, so they fall back to card numbering.
   *
   * -> { groups: [{ n, run, cards: [index…] }], total, runTotal: {run: count},
   *      of: { index: { group, n, run, runIndex, runTotal, card, cards } } }
   */
  function printedSteps(steps) {
    var groups = [], of = {}, runTotal = {}, run = 0;
    steps = isArr(steps) ? steps : [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (!isObj(s) || s.optional) continue;
      var n = (typeof s.n === 'number' && s.n > 0) ? s.n : null;
      var last = groups[groups.length - 1];
      if (last && n !== null && n === last.n) { last.cards.push(i); continue; }
      if (last && n !== null && last.n !== null && n < last.n) run++;
      groups.push({ n: n, run: run, cards: [i] });
    }
    // The printed count is the highest printed number in the run (a step the
    // reader missed must not make the paper's "22" read "22 of 21").
    var runMax = {};
    for (var g = 0; g < groups.length; g++) {
      var r = groups[g].run;
      runTotal[r] = (runTotal[r] || 0) + 1;
      groups[g].runIndex = runTotal[r];
      if (groups[g].n !== null) runMax[r] = Math.max(runMax[r] || 0, groups[g].n);
    }
    for (var rk in runMax) if (runMax.hasOwnProperty(rk)) runTotal[rk] = Math.max(runTotal[rk], runMax[rk]);
    for (var h = 0; h < groups.length; h++) {
      var gr = groups[h];
      for (var c = 0; c < gr.cards.length; c++) {
        of[gr.cards[c]] = {
          group: h, n: gr.n === null ? gr.runIndex : gr.n, run: gr.run,
          runIndex: gr.runIndex, runTotal: runTotal[gr.run], card: c + 1, cards: gr.cards.length
        };
      }
    }
    return { groups: groups, total: groups.length, runTotal: runTotal, runs: run + 1, of: of };
  }

  /** How many printed steps are fully done (every card of them ticked). */
  function printedDone(steps, ps) {
    ps = ps || printedSteps(steps);
    var n = 0;
    for (var g = 0; g < ps.groups.length; g++) {
      var all = true;
      for (var c = 0; c < ps.groups[g].cards.length; c++) if (!steps[ps.groups[g].cards[c]].done) { all = false; break; }
      if (all) n++;
    }
    return n;
  }

  // =====================================================================
  // Wave F: editing the step cards, counting pieces, the shopping list,
  // per-step seam-allowance reminders and the cutting-layout pages.
  // All pure: the UI calls them inside Store.updateCraftData, so every
  // change is one undo step.
  // =====================================================================

  /** A key over a card's WHOLE text (key() stops at 80 characters). */
  function textKey(s) {
    var t = str(s, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
    var h = 5381;
    for (var i = 0; i < t.length; i++) h = (((h << 5) + h) ^ t.charCodeAt(i)) >>> 0;
    return h.toString(36) + '.' + t.length.toString(36);
  }

  function joinSrc(a, b) {
    var out = [];
    (a + '+' + b).split('+').forEach(function (p) { if (p && out.indexOf(p) < 0) out.push(p); });
    return out.join('+');
  }

  /**
   * Sewing.splitStep(data, index, at) -> boolean. Splits card `index` before
   * its sentence `at` (Sewing.sentences numbering, 1..n-1). Both halves keep
   * the printed number, section, page and done flag, so the header reads
   * "Step 4 · card 1 of 2" exactly like a "(continued)" card (05 #1).
   */
  function splitStep(d, index, at) {
    if (!isObj(d) || !isArr(d.steps) || d.steps.length >= 400) return false;
    var st = d.steps[index];
    if (!isObj(st)) return false;
    var parts = sentencesOf(st.text);
    at = Math.floor(at);
    if (!(at >= 1 && at < parts.length)) return false;
    var head = parts.slice(0, at).join(' ').replace(/^\s+|\s+$/g, '');
    var tail = parts.slice(at).join(' ').replace(/^\s+|\s+$/g, '');
    if (!head || !tail) return false;
    var src = st.src || textKey(st.text);
    st.text = head;
    st.src = src;
    var second = {
      id: uid('s'), n: st.n, section: str(st.section, ''), text: tail, done: !!st.done,
      page: typeof st.page === 'number' ? st.page : null, imageRef: null, optional: !!st.optional, src: src
    };
    d.steps.splice(index + 1, 0, second);
    if (typeof d.currentStep === 'number' && d.currentStep > index) d.currentStep++;
    return true;
  }

  /**
   * Sewing.mergeSteps(data, index) -> boolean. Joins card `index` and the
   * card after it. The first card's printed number, section and page win;
   * it is done only when both were. An optional extra never merges into a
   * construction card.
   */
  function mergeSteps(d, index) {
    if (!isObj(d) || !isArr(d.steps)) return false;
    var a = d.steps[index], b = d.steps[index + 1];
    if (!isObj(a) || !isObj(b) || !!a.optional !== !!b.optional) return false;
    var srcA = a.src || textKey(a.text), srcB = b.src || textKey(b.text);
    var src = srcA === srcB ? srcA : joinSrc(srcA, srcB);
    if (src.length > 400) return false;
    var text = (str(a.text, '') + ' ' + str(b.text, '').replace(/^\(continued\)\s*/i, ''))
      .replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (text.length > STEP_SAVED_CAP) return false;
    // Every card cut from either source belongs to the joined one now, so a
    // re-import puts the whole edited run back together.
    for (var i = 0; i < d.steps.length; i++) {
      var sx = d.steps[i];
      if (sx && sx.src && (sx.src === srcA || sx.src === srcB)) sx.src = src;
    }
    a.text = text;
    a.done = !!a.done && !!b.done;
    if (typeof a.page !== 'number' && typeof b.page === 'number') a.page = b.page;
    a.src = src;
    d.steps.splice(index + 1, 1);
    if (typeof d.currentStep === 'number' && d.currentStep > index) d.currentStep--;
    return true;
  }

  /** Pieces cut and pieces to cut, over every row ('3 of 56'), plus the rows. */
  function cutTotals(d) {
    var rows = (isObj(d) && isArr(d.cutting)) ? d.cutting : [];
    var out = { cut: 0, total: 0, rows: rows.length, rowsDone: 0 };
    for (var i = 0; i < rows.length; i++) {
      var q = Math.max(0, rows[i].qty | 0), c = Math.max(0, Math.min(q, rows[i].cutCount | 0));
      out.cut += c;
      out.total += q;
      if (q > 0 && c >= q) out.rowsDone++;
    }
    return out;
  }

  /**
   * The one-line "what this means at the cutting table" for a row, or ''.
   * '2 mirrored' is a pair: one left and one right (05 #3, Wave F).
   */
  function cutHint(row) {
    if (!isObj(row)) return '';
    var q = Math.max(1, row.qty | 0);
    var g = str(row.grain, '').toLowerCase();
    if (/^(?:mirror|mirrored|reverse|reversed|pair)$/.test(g)) {
      if (q % 2 === 0) {
        var pairs = q / 2;
        return q + ' mirrored = ' + pairs + (pairs === 1 ? ' pair' : ' pairs') +
          ': cut through two layers, or flip the pattern piece over for the second of each pair';
      }
      return 'mirrored: flip the pattern piece over to cut it';
    }
    if (row.onFold) {
      return 'on the fold: marked edge on the fabric fold — each cut opens out into one whole piece' +
        (q > 1 ? ' (' + q + ' cuts)' : '');
    }
    if (/bias/.test(g)) return 'on the bias: lay the grainline at 45° to the selvedge';
    if (/crosswise/.test(g)) return 'crosswise: grainline across the fabric, selvedge to selvedge';
    return '';
  }

  /**
   * Sewing.shoppingList(data, { fabric, notions, thread }) -> string[] (05 #5).
   * Fabric first (that is why you are in the shop): the chosen size's amount
   * per bolt width, else the row as printed. Then the notions not yet
   * ticked, then "Thread to match" unless thread is already listed. The
   * pattern's strings are kept verbatim; nothing is converted.
   */
  function shoppingList(d, opts) {
    opts = opts || {};
    var out = [];
    if (!isObj(d)) return out;
    var fabric = isArr(d.fabric) ? d.fabric : [], notions = isArr(d.notions) ? d.notions : [];
    var size = isObj(d.size) ? d.size : { sizeLabels: [], chosen: '' };
    function fabricName(name) {
      name = str(name, '');
      return !name || /^fabric$/i.test(name) ? 'fabric' : name;
    }
    if (opts.fabric !== false && fabric.length) {
      var mine = fabricForSize(fabric, size.sizeLabels, size.chosen);
      if (mine.length) {
        mine.forEach(function (r) {
          var src = null;
          for (var fr = 0; fr < fabric.length && !src; fr++) {
            if (fabric[fr].name === r.name && fabric[fr].width === r.width) src = fabric[fr];
          }
          var varies = !!src && src.amounts.some(function (x) { return x !== src.amounts[0]; });
          out.push(r.amount + ' — ' + fabricName(r.name) + (r.width ? ', ' + r.width + ' wide' : '') +
            (varies ? ' (size ' + size.chosen + ')' : ''));
        });
      } else {
        var labels = isArr(size.sizeLabels) ? size.sizeLabels : [];
        fabric.forEach(function (r) {
          var what = fabricName(r.name) + (r.width ? ', ' + r.width + ' wide' : '');
          var amts = r.amounts || [];
          var same = amts.length > 0;
          for (var a = 1; a < amts.length; a++) if (amts[a] !== amts[0]) same = false;
          if (same && (amts.length === 1 || amts.length === labels.length) && !r.groupLabels) {
            out.push(amts[0] + ' — ' + what);
          } else if (labels.length && amts.length === labels.length) {
            // No size chosen yet: every size range with its amount, as printed.
            var runs = [], from = 0;
            for (var b = 1; b <= amts.length; b++) {
              if (b === amts.length || amts[b] !== amts[from]) {
                runs.push((b - 1 > from ? labels[from] + '–' + labels[b - 1] : labels[from]) + ' ' + amts[from]);
                from = b;
              }
            }
            out.push(what + ': ' + runs.join(' · '));
          } else if (r.groupLabels && r.groupLabels.length === r.rawAmounts.length) {
            out.push(what + ': ' + r.rawAmounts.map(function (x, gi) { return 'sizes ' + r.groupLabels[gi] + ' ' + x; }).join(' · '));
          } else if (r.line) {
            out.push(r.line);
          } else {
            out.push(fabricName(r.name) + (r.width ? ', ' + r.width + ' wide' : ''));
          }
        });
      }
    }
    if (opts.notions !== false) {
      // A notion that only names a fabric already on the list ('Lightweight
      // Fusing', 'Matching linings' beside the FUSING and LINING rows) would
      // send the sewist to buy it twice.
      var fabNames = [];
      if (opts.fabric !== false) {
        fabric.forEach(function (r) {
          var nm = str(r.name, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
          if (nm.length >= 4 && !/^fabric$/.test(nm) && /^[a-z ]{4,30}$/.test(nm)) {
            fabNames.push(new RegExp('\\b' + nm.replace(/s$/, '').split(' ').join('\\s+') + '(?:s|es)?\\b', 'i'));
          }
        });
      }
      notions.forEach(function (n) {
        if (n.have || !n.text) return;
        for (var fx = 0; fx < fabNames.length; fx++) if (fabNames[fx].test(n.text)) return;
        out.push(n.text);
      });
    }
    if (opts.thread !== false) {
      var hasThread = false;
      notions.forEach(function (n) { if (/\bthreads?\b/i.test(n.text)) hasThread = true; });
      if (!hasThread) out.push('Thread to match');
    }
    // The same line printed in two blocks (a fusing row that is also a notion).
    var seenLine = {};
    return out.filter(function (l) {
      var k = textKey(l);
      if (seenLine[k]) return false;
      seenLine[k] = 1;
      return true;
    });
  }

  /** The parts an exception names: 'Except Neckline, Armhole and pocket edge which are 6mm' -> 3. */
  function saPhrases(text) {
    var s = str(text, '');
    var m = SA_EXCEPT_SPLIT.exec(s);
    var tail = m ? s.slice(m.index + m[0].length) : s;
    tail = tail.split(/\b(?:which|that|are|is|at|should|use|using|sewn|stitched|where|has|have|with)\b|[:;(\d]/i)[0];
    var out = [];
    tail.split(/\s*(?:,|\band\b|&|\/|\bor\b)\s*/i).forEach(function (p) {
      p = p.replace(/^\s*(?:the|all|any)\s+/i, '').replace(/\s*(?:seams?|edges? seams?)\s*$/i, function (w) {
        return /edge/i.test(w) ? ' edge' : '';
      }).replace(/[^A-Za-z \-]/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase();
      if (p.length >= 3 && p.length <= 30 && !/^(?:seams?|allowances?|the|all)$/.test(p) && out.indexOf(p) < 0) out.push(p);
    });
    return out.slice(0, 8);
  }

  /**
   * Sewing.saReminder(data, stepText) -> { mm, inches, part, text } | null.
   * When a step mentions a part the seam-allowance exception names (sundress:
   * neckline, armhole, pocket edge at 6 mm), the step card reminds the sewist
   * at the point of use (05 #15). Worded as a reminder, never as a rule.
   */
  function saReminder(d, stepText) {
    var sa = isObj(d) ? d.seamAllowance : null;
    var t = str(stepText, '');
    if (!sa || !isArr(sa.exceptions) || !t) return null;
    for (var i = 0; i < sa.exceptions.length; i++) {
      var ex = sa.exceptions[i];
      if (!isObj(ex) || typeof ex.mm !== 'number') continue;
      var phrases = saPhrases(ex.text);
      for (var p = 0; p < phrases.length; p++) {
        var words = phrases[p].split(' ').map(function (w) { return w.replace(/[-]/g, '\\-'); });
        var re = new RegExp('\\b' + words.join('\\s+') + '(?:s|es)?\\b', 'i');
        if (re.test(t)) {
          var inch = /(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(?:"|''|in\b|inch)/i.exec(ex.text);
          return { mm: ex.mm, inches: inch ? inch[1].replace(/\s+/g, '') : '', part: phrases[p], text: ex.text };
        }
      }
    }
    return null;
  }

  // 'CUTTING LAYOUTS', 'Cutting layout', 'Layout plan', 'Cutting diagrams' —
  // the page the sewist lays the pieces out from (05 #7, Wave F). Samford
  // prints it kerning-split ('CUT TING L AYOUTS').
  // Pattern Runway captions the page instead: 'Cutting layouts show
  // approximate position of pattern…' (pencil skirt and sundress p5).
  var LAYOUT_HEAD_RE = /^(?:cutting\s+(?:layouts?|lay-?\s?outs?|diagrams?|plans?)|(?:fabric\s+)?layouts?(?:\s+(?:plans?|guides?|diagrams?))?|lay-?\s?plans?)\b(?:\s*[:(].{0,30})?$|^cutting\s+layouts?\s+(?:show|are|for|below)\b/i;

  /** Sewing.layoutPages(sourceText) -> the page numbers of the cutting-layout pages. */
  function layoutPages(text) {
    var out = [];
    var lines;
    try { lines = toLines(str(text, '')); } catch (e) { return out; }
    function shortCaps(j) {
      var x = j >= 0 && j < lines.length && !lines[j].pageMark ? str(lines[j].text, '') : '';
      return !!x && x.length <= 24 && !/[a-z]/.test(x) && /[A-Z]{3}/.test(x);
    }
    for (var i = 0; i < lines.length && out.length < 12; i++) {
      var t = lines[i].text;
      if (!t || lines[i].pageMark || t.length > 72 || typeof lines[i].page !== 'number') continue;
      // One of a stack of side headings ('PRINTING THE PDF / PATTERN / CUTTING
      // TIPS / CUTTING LAYOUTS / TRACE', Samford p8) names a paragraph that
      // points at the layouts; it is not the layout page itself.
      if (shortCaps(i - 1) && shortCaps(i + 1)) continue;
      var forms = [t, unkern(t), despacedHeading(t) || ''];
      for (var f = 0; f < forms.length; f++) {
        if (forms[f] && LAYOUT_HEAD_RE.test(forms[f].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''))) {
          if (out.indexOf(lines[i].page) < 0) out.push(lines[i].page);
          break;
        }
      }
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /** Is this cutting row / notion exactly one a built-in template seeds? */
  function isTemplateCut(r) {
    for (var t = 0; t < TEMPLATES.length; t++) {
      var rows = (TEMPLATES[t].craftData && TEMPLATES[t].craftData.cutting) || [];
      for (var i = 0; i < rows.length; i++) {
        if (key(rows[i].piece) === key(r.piece) && rows[i].qty === r.qty && rows[i].material === r.material) return true;
      }
    }
    return false;
  }
  function isTemplateNotion(r) {
    for (var t = 0; t < TEMPLATES.length; t++) {
      var rows = (TEMPLATES[t].craftData && TEMPLATES[t].craftData.notions) || [];
      for (var i = 0; i < rows.length; i++) if (key(rows[i].text) === key(r.text)) return true;
    }
    return false;
  }

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
    paragraphCandidates: paragraphCandidates,
    sentences: sentencesOf,
    sizeGroups: sizeGroups,
    fabricAmounts: amountTexts,
    fabricForSize: fabricForSize,
    printedSteps: printedSteps,
    printedDone: printedDone,
    // Wave F
    splitStep: splitStep,
    mergeSteps: mergeSteps,
    textKey: textKey,
    cutTotals: cutTotals,
    cutHint: cutHint,
    shoppingList: shoppingList,
    saReminder: saReminder,
    saPhrases: saPhrases,
    layoutPages: layoutPages,
    gridFabric: gridFabric,
    optionalHead: optionalHead,
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
    despacedHeading: despacedHeading,
    detectSheet: detectSheet,
    labelOnly: labelOnly,
    plainFabricRow: plainFabricRow,
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
